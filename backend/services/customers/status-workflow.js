'use strict';
// Membership status workflow (pure, unit-tested).
//
//   active  --suspend-->  suspended  --reactivate-->  active
//   active | suspended  --erasure workflow (DELETE)-->  erased   (final, no way back)
//
// A suspended customer cannot log in (Cognito user disabled), cannot earn points
// (Points service checks status) and cannot redeem (Rewards checks status).

const TRANSITIONS = {
  active: ['suspended'],
  suspended: ['active'],
  erased: [],
};

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

module.exports = { TRANSITIONS, canTransition };
