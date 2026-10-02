import { Injectable } from '@nestjs/common';

export type OrgType = 'restaurant' | 'grocer' | 'fleet';

export interface Org {
  id: string;
  type: OrgType;
  name: string;
  cityId: string;
  memberIds: string[];
}

@Injectable()
export class OrgsService {
  private readonly orgs = new Map<string, Org>();
  private seq = 0;

  create(input: Omit<Org, 'id' | 'memberIds'> & { ownerId: string }): Org {
    this.seq += 1;
    const org: Org = { id: `org_${this.seq}`, type: input.type, name: input.name, cityId: input.cityId, memberIds: [input.ownerId] };
    this.orgs.set(org.id, org);
    return org;
  }

  addMember(orgId: string, personId: string): Org {
    const org = this.get(orgId);
    if (!org.memberIds.includes(personId)) org.memberIds.push(personId);
    return org;
  }

  get(orgId: string): Org {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`org ${orgId} not found`);
    return org;
  }

  inCity(cityId: string, type?: OrgType): Org[] {
    return [...this.orgs.values()].filter((o) => o.cityId === cityId && (type === undefined || o.type === type));
  }
}
