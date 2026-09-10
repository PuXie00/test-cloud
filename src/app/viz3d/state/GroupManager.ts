export type ReparentFn = (childId: string, parentGroupId: string | null) => void;

export class GroupManager {
  private readonly groups = new Map<string, Set<string>>();
  private readonly memberToGroup = new Map<string, string>();
  private counter = 0;

  constructor(private readonly reparent: ReparentFn) {}

  group(memberIds: string[]): string | null {
    if (memberIds.length < 2) {
      return null;
    }

    const groupId = `grp-${++this.counter}`;
    const members = new Set(memberIds);
    this.groups.set(groupId, members);
    memberIds.forEach((memberId) => {
      this.memberToGroup.set(memberId, groupId);
      this.reparent(memberId, groupId);
    });
    return groupId;
  }

  ungroup(groupId: string): void {
    const members = this.groups.get(groupId);
    if (!members) {
      return;
    }

    members.forEach((memberId) => {
      this.memberToGroup.delete(memberId);
      this.reparent(memberId, null);
    });
    this.groups.delete(groupId);
  }

  memberIds(groupId: string): string[] {
    return [...(this.groups.get(groupId) ?? [])];
  }

  resolveGroup(objectId: string): string | null {
    return this.memberToGroup.get(objectId) ?? null;
  }

  resolveMembers(objectId: string): string[] {
    const groupId = this.resolveGroup(objectId);
    if (!groupId) {
      return [objectId];
    }
    return this.memberIds(groupId);
  }

  getGroups(): string[] {
    return [...this.groups.keys()];
  }
}
