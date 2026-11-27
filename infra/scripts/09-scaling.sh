#!/usr/bin/env bash
# 09-scaling.sh (owner: Jana) - scale the Points service.
# AWS services: Lambda (alias + provisioned concurrency), Application Auto Scaling,
# Elastic Load Balancing (Application Load Balancer with a Lambda target group), EC2 (VPC for the ALB).
# Run after 04-points.sh and before 06-api-gateway.sh. Safe to run again.
source "$(dirname "$0")/00-env.sh"
ALIAS=live
MIN_PC=1
MAX_PC=4

log "Alias '$ALIAS' for $FN_POINTS (a fixed version that can have warm copies)"
VERSION="$(aws lambda publish-version --function-name "$FN_POINTS" --query Version --output text)"
if aws lambda get-alias --function-name "$FN_POINTS" --name "$ALIAS" >/dev/null 2>&1; then
  aws lambda update-alias --function-name "$FN_POINTS" --name "$ALIAS" --function-version "$VERSION" >/dev/null
else
  aws lambda create-alias --function-name "$FN_POINTS" --name "$ALIAS" --function-version "$VERSION" >/dev/null
fi
ALIAS_ARN="arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:${FN_POINTS}:${ALIAS}"
save_output POINTS_ALIAS_ARN "$ALIAS_ARN"
ok "alias $ALIAS -> version $VERSION"

log "Provisioned concurrency: $MIN_PC warm copy, no cold start"
if aws lambda put-provisioned-concurrency-config --function-name "$FN_POINTS" --qualifier "$ALIAS" \
     --provisioned-concurrent-executions "$MIN_PC" >/dev/null 2>&1; then
  ok "provisioned concurrency = $MIN_PC"
else
  warn "provisioned concurrency not accepted here (Floci records only); continuing"
fi

log "Application Auto Scaling: min $MIN_PC, max $MAX_PC, target 50% utilisation"
RES="function:${FN_POINTS}:${ALIAS}"
if aws application-autoscaling register-scalable-target --service-namespace lambda --resource-id "$RES" \
     --scalable-dimension lambda:function:ProvisionedConcurrency \
     --min-capacity "$MIN_PC" --max-capacity "$MAX_PC" >/dev/null 2>&1; then
  ok "scalable target registered"
  aws application-autoscaling put-scaling-policy --policy-name points-target-50 --service-namespace lambda \
    --resource-id "$RES" --scalable-dimension lambda:function:ProvisionedConcurrency \
    --policy-type TargetTrackingScaling \
    --target-tracking-scaling-policy-configuration '{"TargetValue":0.5,"PredefinedMetricSpecification":{"PredefinedMetricType":"LambdaProvisionedConcurrencyUtilization"}}' \
    >/dev/null 2>&1 && ok "scaling policy points-target-50" || warn "scaling policy not accepted here"
else
  warn "Application Auto Scaling not accepted here; continuing"
fi

alb_setup() {
  if [ -z "${ALB_VPC_ID:-}" ] || ! aws ec2 describe-vpcs --vpc-ids "$ALB_VPC_ID" >/dev/null 2>&1; then
    ALB_VPC_ID="$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --query Vpc.VpcId --output text)" || return 1
    ALB_SUB_A="$(aws ec2 create-subnet --vpc-id "$ALB_VPC_ID" --cidr-block 10.0.1.0/24 \
      --availability-zone "${AWS_REGION}a" --query Subnet.SubnetId --output text)" || return 1
    ALB_SUB_B="$(aws ec2 create-subnet --vpc-id "$ALB_VPC_ID" --cidr-block 10.0.2.0/24 \
      --availability-zone "${AWS_REGION}b" --query Subnet.SubnetId --output text)" || return 1
    ALB_SG="$(aws ec2 create-security-group --group-name loyalty-alb-sg --description "ALB: HTTP in" \
      --vpc-id "$ALB_VPC_ID" --query GroupId --output text)" || return 1
    aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null || return 1
    save_output ALB_VPC_ID "$ALB_VPC_ID"; save_output ALB_SUB_A "$ALB_SUB_A"
    save_output ALB_SUB_B "$ALB_SUB_B"; save_output ALB_SG "$ALB_SG"
  fi
  TG_ARN="$(aws elbv2 describe-target-groups --names loyalty-points-tg --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null || aws elbv2 create-target-group --name loyalty-points-tg --target-type lambda \
    --query 'TargetGroups[0].TargetGroupArn' --output text)" || return 1
  aws lambda add-permission --function-name "${FN_POINTS}:${ALIAS}" --statement-id alb-invoke \
    --action lambda:InvokeFunction --principal elasticloadbalancing.amazonaws.com \
    --source-arn "$TG_ARN" >/dev/null 2>&1 || true
  aws elbv2 register-targets --target-group-arn "$TG_ARN" --targets "Id=$ALIAS_ARN" >/dev/null || return 1
  ALB_ARN="$(aws elbv2 describe-load-balancers --names loyalty-alb --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null || aws elbv2 create-load-balancer --name loyalty-alb --subnets "$ALB_SUB_A" "$ALB_SUB_B" \
    --security-groups "$ALB_SG" --scheme internet-facing --type application \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)" || return 1
  LISTENER_ARN="$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
    --query 'Listeners[0].ListenerArn' --output text 2>/dev/null || true)"
  if [ -z "$LISTENER_ARN" ] || [ "$LISTENER_ARN" = "None" ]; then
    LISTENER_ARN="$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
      --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=Not found}' \
      --query 'Listeners[0].ListenerArn' --output text)" || return 1
    aws elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority 10 \
      --conditions 'Field=path-pattern,Values=/api/transactions*,/api/earn-rules*,/api/adjustments*,/api/reports/staff-activity*,/api/customers/*/balance' \
      --actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null || return 1
  fi
  save_output ALB_ARN "$ALB_ARN"; save_output ALB_TARGET_GROUP_ARN "$TG_ARN"
  ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --query 'LoadBalancers[0].DNSName' --output text)"
  save_output ALB_DNS "$ALB_DNS"
  ok "load balancer loyalty-alb ($ALB_DNS) -> target group loyalty-points-tg -> $FN_POINTS:$ALIAS"
}
log "Application Load Balancer in front of the Points alias"
if alb_setup; then :; else warn "load balancer setup stopped; see the message above"; fi
