import { describe, expect, it, vi } from 'vitest';
import { Helix } from '../src/twitch/helix.js';
const session = { accessToken: 'secret', broadcasterId: 'owner' };
function setup(responses: Response[], moderation = true) {
  const request = vi.fn<typeof fetch>(); for (const r of responses) request.mockResolvedValueOnce(r);
  const auth = { getChatSession: () => session, getModerationSession: () => moderation ? session : undefined, refresh: vi.fn(async () => {}) };
  return { request, auth, helix: new Helix('client', auth, request, () => 0, async () => {}) };
}
describe('Helix moderation', () => {
  it('deletes one message by ID with broadcaster as moderator', async () => {
    const { helix, request } = setup([new Response(null, { status: 204 })]);
    await helix.deleteMessage('abc-123');
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe('https://api.twitch.tv/helix/moderation/chat?broadcaster_id=owner&moderator_id=owner&message_id=abc-123');
    expect(init!.method).toBe('DELETE');
  });
  it('refuses a delete without a valid message ID (Twitch would clear the whole chat)', async () => {
    const { helix, request } = setup([]);
    await expect(helix.deleteMessage('')).rejects.toThrow('Refusing');
    await expect(helix.deleteMessage('a&message_id=')).rejects.toThrow('Refusing');
    expect(request).not.toHaveBeenCalled();
  });
  it('sends chat, warns and toggles Shield Mode with the documented bodies', async () => {
    const ok = () => new Response(JSON.stringify({ data: [{ is_sent: true }] }), { status: 200 });
    const { helix, request } = setup([ok(), ok(), ok()]);
    await helix.sendChat('hello'); await helix.warnUser('viewer', 'reason'); await helix.setShieldMode(true);
    const bodies = request.mock.calls.map(c => JSON.parse(String(c[1]!.body)));
    expect(bodies).toEqual([{ broadcaster_id: 'owner', sender_id: 'owner', message: 'hello' }, { data: { user_id: 'viewer', reason: 'reason' } }, { is_active: true }]);
    expect(request.mock.calls.map(c => `${c[1]!.method} ${String(c[0]).split('?')[0]}`)).toEqual(['POST https://api.twitch.tv/helix/chat/messages', 'POST https://api.twitch.tv/helix/moderation/warnings', 'PUT https://api.twitch.tv/helix/moderation/shield_mode']);
  });
  it('refreshes once on 401, reports dropped chat, and fails without moderation scopes', async () => {
    const { helix, auth } = setup([new Response(null, { status: 401 }), new Response(null, { status: 204 })]);
    await helix.deleteMessage('m1'); expect(auth.refresh).toHaveBeenCalledTimes(1);
    const dropped = setup([new Response(JSON.stringify({ data: [{ is_sent: false }] }), { status: 200 })]);
    await expect(dropped.helix.sendChat('x')).rejects.toThrow('dropped');
    const noScope = setup([], false);
    await expect(noScope.helix.deleteMessage('m1')).rejects.toThrow('Moderation permission not granted');
  });
});
