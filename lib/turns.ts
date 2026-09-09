import type { BillingMember } from './room-current';

export function eligibleMembers(members: BillingMember[]) {
  return members.filter((member) => member.is_active && member.current_due > 0);
}

export function resolveNextPayer(members: BillingMember[], storedUsername?: string) {
  const eligible = eligibleMembers(members);
  if (!eligible.length) return null;
  if (!storedUsername) return eligible[0];

  const stored = members.findIndex((member) => member.username === storedUsername);
  const storedStillEligible = eligible.find((member) => member.username === storedUsername);
  if (storedStillEligible) return storedStillEligible;
  if (stored < 0) return eligible[0];

  for (let offset = 1; offset <= members.length; offset += 1) {
    const candidate = members[(stored + offset) % members.length];
    if (candidate.is_active && candidate.current_due > 0) return candidate;
  }
  return null;
}

export function nextAfter(members: BillingMember[], username: string) {
  const eligible = eligibleMembers(members);
  if (!eligible.length) return null;
  const start = members.findIndex((member) => member.username === username);
  if (start < 0) return eligible[0];
  for (let offset = 1; offset <= members.length; offset += 1) {
    const candidate = members[(start + offset) % members.length];
    if (candidate.is_active && candidate.current_due > 0) return candidate;
  }
  return null;
}

export function afterNextPayment(member: BillingMember) {
  return Math.max(0, member.current_due - member.next_payment);
}
