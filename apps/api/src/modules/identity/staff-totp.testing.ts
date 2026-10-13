import { totpCode, totpStep } from './totp.js';

/** The slice of a tRPC client the helper drives (any `createTRPCClient<AppRouter>` fits). */
interface StepClient {
  identity: {
    authenticator: {
      enrol: { mutate(): Promise<{ secret: string }> };
      confirm: { mutate(input: { code: string }): Promise<unknown> };
      verify: { mutate(input: { code: string }): Promise<unknown> };
    };
  };
}

const secrets = new Map<string, { secret: string; lastStep: number }>();

/**
 * Tests over the wire: passes the admin/finance authenticator step for a signed-in client the way a
 * person does (docs/api/staff-totp.md): the first time it sets the app up and confirms with its code;
 * after that it types the next code. Real clock, so at most a couple of passes per person every 30 s.
 */
export async function passSecondStep(client: StepClient, personId: string): Promise<void> {
  const known = secrets.get(personId);
  if (!known) {
    const { secret } = await client.identity.authenticator.enrol.mutate();
    const step = totpStep(new Date());
    await client.identity.authenticator.confirm.mutate({ code: totpCode(secret, step) });
    secrets.set(personId, { secret, lastStep: step });
    return;
  }
  const step = Math.max(totpStep(new Date()), known.lastStep + 1);
  await client.identity.authenticator.verify.mutate({ code: totpCode(known.secret, step) });
  known.lastStep = step;
}

/** Whether a role list holds admin or finance (the roles that owe the step). */
export function owesSecondStep(roles: ReadonlyArray<string | { kind: string }>): boolean {
  return roles.some((r) => ['admin', 'finance'].includes(typeof r === 'string' ? r : r.kind));
}
