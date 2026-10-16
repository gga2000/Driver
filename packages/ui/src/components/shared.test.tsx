import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatThreadView } from '@driver/contracts';
import { renderUI } from '../test/render';
import { VOICE_CANCEL_SLIDE_PX, type MicPermission } from '../logic/voice-note';
import { ChatThread, type ChatThreadProps, type ChatVoice } from './ChatThread';
import { CountdownButton } from './CountdownButton';
import { ModalSheet } from './ModalSheet';
import { OtpInput, otpValue } from './OtpInput';
import { PermissionPrompt } from './PermissionPrompt';
import { SlideToConfirm } from './SlideToConfirm';
import { TabBar } from './TabBar';
import { ToastProvider } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('SlideToConfirm', () => {
  it('is one button named after the action, with a hint that says how', () => {
    renderUI(<SlideToConfirm label="استلمت الطلب" onConfirm={() => {}} mode="slide" />, { reduceMotion: false });
    const el = screen.getByTestId('slide-to-confirm');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('استلمت الطلب');
    expect(screen.getByTestId('slide-to-confirm-label').textContent).toBe('استلمت الطلب');
  });

  it('Enter or Space confirms once (the keyboard / screen-reader alternative), with the success haptic', () => {
    const onConfirm = vi.fn();
    const haptic = vi.fn();
    renderUI(<SlideToConfirm label="سلّمت" onConfirm={onConfirm} mode="slide" />, { reduceMotion: false, haptics: haptic });
    const el = screen.getByTestId('slide-to-confirm');
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: ' ' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('success');
  });

  it('ignores other keys, and does nothing while disabled or loading', () => {
    const onConfirm = vi.fn();
    const { rerender } = renderUI(<SlideToConfirm label="سلّمت" onConfirm={onConfirm} disabled mode="slide" />, { reduceMotion: false });
    fireEvent.keyDown(screen.getByTestId('slide-to-confirm'), { key: 'Enter' });
    rerender(<SlideToConfirm label="سلّمت" onConfirm={onConfirm} loading mode="slide" />);
    fireEvent.keyDown(screen.getByTestId('slide-to-confirm'), { key: 'Enter' });
    rerender(<SlideToConfirm label="سلّمت" onConfirm={onConfirm} mode="slide" />);
    fireEvent.keyDown(screen.getByTestId('slide-to-confirm'), { key: 'a' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('slide-to-confirm').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('comes back for the next step after the action finishes', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const { rerender } = renderUI(<SlideToConfirm label="صعد الراكب" onConfirm={onConfirm} mode="slide" />, { reduceMotion: false });
    fireEvent.keyDown(screen.getByTestId('slide-to-confirm'), { key: 'Enter' });
    rerender(<SlideToConfirm label="صعد الراكب" onConfirm={onConfirm} loading mode="slide" />);
    rerender(<SlideToConfirm label="صعد الراكب" onConfirm={onConfirm} mode="slide" />);
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.keyDown(screen.getByTestId('slide-to-confirm'), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('reduced motion: press and hold 0.9 s confirms; letting go early does not', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    renderUI(<SlideToConfirm label="انطلقنا" onConfirm={onConfirm} />, { reduceMotion: true });
    const el = screen.getByTestId('slide-to-confirm');
    expect(el.getAttribute('aria-label')).toBe('انطلقنا');
    fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, buttons: 1 });
    fireEvent.mouseDown(el, { button: 0 });
    act(() => void vi.advanceTimersByTime(500));
    fireEvent.pointerUp(el, { pointerType: 'touch', button: 0 });
    fireEvent.mouseUp(el, { button: 0 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, buttons: 1 });
    fireEvent.mouseDown(el, { button: 0 });
    act(() => void vi.advanceTimersByTime(950));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('CountdownButton', () => {
  it('shows the seconds left, accepts on a tap, and expires once', () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const clock = () => now;
    const onPress = vi.fn();
    const onExpire = vi.fn();
    const haptic = vi.fn();
    renderUI(<CountdownButton label="اقبل" onPress={onPress} onExpire={onExpire} startedAt={now} durationMs={15_000} clock={clock} />, { haptics: haptic });
    expect(screen.getByTestId('countdown-button-seconds').textContent).toBe('15');
    now += 10_400;
    act(() => void vi.advanceTimersByTime(250));
    expect(screen.getByTestId('countdown-button-seconds').textContent).toBe('5');
    expect(haptic).toHaveBeenCalledWith('warning');
    fireEvent.click(screen.getByTestId('countdown-button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('medium');
    now += 6_000;
    act(() => void vi.advanceTimersByTime(500));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('countdown-button').getAttribute('aria-disabled')).toBe('true');
  });

  it('the fill is the time left', () => {
    const now = 2_000_000;
    renderUI(<CountdownButton label="اقبل" onPress={() => {}} startedAt={now - 5_000} durationMs={20_000} clock={() => now} />, { reduceMotion: true });
    expect(screen.getByTestId('countdown-button-fill').style.width).toBe('75%');
  });
});

describe('ModalSheet', () => {
  it('is a modal: header title, the panel marked modal, scrim and ✕ named "سد"', () => {
    const onClose = vi.fn();
    renderUI(
      <ModalSheet visible onClose={onClose} title="رمز التسليم" testID="sheet">
        <span>body</span>
      </ModalSheet>,
    );
    expect(screen.getByTestId('sheet-title').getAttribute('role')).toBe('heading');
    expect(screen.getByTestId('sheet').getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(screen.getByTestId('sheet-scrim').getAttribute('aria-label')).toBe('سد');
    fireEvent.click(screen.getByTestId('sheet-scrim'));
    fireEvent.click(screen.getByTestId('sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape closes it on the web', () => {
    const onClose = vi.fn();
    renderUI(
      <ModalSheet visible onClose={onClose} title="x" testID="sheet">
        <span>body</span>
      </ModalSheet>,
    );
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locked: nothing closes it and the ✕ is gone', () => {
    const onClose = vi.fn();
    renderUI(
      <ModalSheet visible onClose={onClose} title="x" locked testID="sheet">
        <span>body</span>
      </ModalSheet>,
    );
    fireEvent.click(screen.getByTestId('sheet-scrim'));
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(screen.queryByTestId('sheet-close')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing while hidden, and takes an app close label', () => {
    const { rerender } = renderUI(
      <ModalSheet visible={false} onClose={() => {}} title="x" testID="sheet">
        <span>body</span>
      </ModalSheet>,
    );
    expect(screen.queryByTestId('sheet')).toBeNull();
    rerender(
      <ModalSheet visible onClose={() => {}} title="x" closeLabel="سكّر" testID="sheet">
        <span>body</span>
      </ModalSheet>,
    );
    expect(screen.getByTestId('sheet-scrim').getAttribute('aria-label')).toBe('سكّر');
  });
});

describe('OtpInput', () => {
  it('keeps Western digits only, capped at the length', () => {
    expect(otpValue('١٢٣ 456 7')).toBe('123456');
    expect(otpValue('۴۵۶', 4)).toBe('456');
  });

  it('finds the code in a pasted message, wherever it sits (CORE-21)', () => {
    expect(otpValue('رمز دخولك لدرايفر: 482913. لا تعطيه لأحد.')).toBe('482913');
    expect(otpValue('Driver 2026 code: ٤٨٢٩١٣')).toBe('482913');
    expect(otpValue('  482913  ')).toBe('482913');
    expect(otpValue('code 482 913')).toBe('482913');
  });

  it('draws one cell per digit and passes the cleaned code up', () => {
    function Harness() {
      const [v, setV] = useState('');
      return <OtpInput value={v} onChange={setV} accessibilityLabel="الرمز" />;
    }
    renderUI(<Harness />);
    const input = screen.getByTestId('otp-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '٤٢x1' } });
    expect(input.value).toBe('421');
    expect(input.getAttribute('aria-label')).toBe('الرمز');
  });
});

describe('TabBar', () => {
  const routes = [
    { key: 'a', name: 'index' },
    { key: 'b', name: 'earnings' },
  ];
  const tabs = [
    { name: 'index', label: 'الرئيسية', icon: 'home' as const },
    { name: 'earnings', label: 'أرباحي', icon: 'wallet' as const, badge: 2 },
  ];

  it('tabs with the selected state; pressing another navigates', () => {
    const navigate = vi.fn();
    const emit = vi.fn(() => ({ defaultPrevented: false }));
    renderUI(<TabBar state={{ index: 0, routes }} navigation={{ emit, navigate }} tabs={tabs} />);
    expect(screen.getByTestId('tab-index').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('tab-earnings').getAttribute('aria-label')).toBe('أرباحي · 2');
    fireEvent.click(screen.getByTestId('tab-earnings'));
    expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'b', canPreventDefault: true });
    expect(navigate).toHaveBeenCalledWith('earnings', undefined);
    fireEvent.click(screen.getByTestId('tab-index'));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('PermissionPrompt', () => {
  it('says what you get, then allow or later (the scrim means later)', () => {
    const onAllow = vi.fn();
    const onLater = vi.fn();
    renderUI(
      <PermissionPrompt visible title="خلّي نخبرك" body="بس عن طلبك" points={[{ icon: 'clock', label: 'وين وصل طلبك' }]} allowLabel="إي، شغّلها" laterLabel="بعدين" onAllow={onAllow} onLater={onLater} />,
    );
    expect(screen.getByText('وين وصل طلبك')).toBeTruthy();
    expect(screen.getByTestId('push-preprompt').getAttribute('aria-modal')).toBe('true');
    fireEvent.click(screen.getByTestId('push-preprompt-allow'));
    fireEvent.click(screen.getByTestId('push-preprompt-later'));
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(2);
  });
});

describe('ChatThread', () => {
  const view = (over: Partial<ChatThreadView> = {}): ChatThreadView => ({
    threadId: 'th1',
    orderId: 'ord_abc123',
    kind: 'customer_courier',
    status: 'open',
    closesAt: null,
    myRole: 'customer',
    ride: false,
    participants: [
      { role: 'customer', name: 'علي', you: true },
      { role: 'courier', name: 'حيدر', you: false },
    ],
    messages: [
      { id: 'm1', seq: 1, senderRole: 'courier', mine: false, kind: 'text', text: 'وصلت', quickReplyKey: null, photoUrl: null, audioUrl: null, durationSec: null, location: null, masked: false, createdAt: new Date(), read: false },
      { id: 'm2', seq: 2, senderRole: 'customer', mine: true, kind: 'text', text: 'نازل', quickReplyKey: null, photoUrl: null, audioUrl: null, durationSec: null, location: null, masked: false, createdAt: new Date(), read: true },
    ],
    lastSeq: 2,
    myReadSeq: 1,
    unread: 1,
    quickReplies: ['courier_two_min'],
    canCall: true,
    serverNow: new Date(),
    ...over,
  });

  function setup(over: Partial<ChatThreadProps> = {}, data = view()) {
    const props: ChatThreadProps = {
      orderId: 'ord_abc123',
      kind: 'customer_courier',
      thread: { data, isError: false, error: null, refetch: vi.fn() },
      t: (k, p) => (p ? `${k}${JSON.stringify(p)}` : k),
      locale: 'ar-IQ',
      send: vi.fn(async () => ({})),
      markRead: vi.fn(),
      refresh: vi.fn(async () => undefined),
      call: vi.fn(),
      calling: false,
      onBack: vi.fn(),
      errorMessage: (_e, f) => f,
      errorCode: () => null,
      photoUri: (u) => u,
      attachPhoto: vi.fn(async () => null),
      ...over,
    };
    renderUI(
      <ToastProvider>
        <ChatThread {...props} />
      </ToastProvider>,
    );
    return props;
  }

  it('shows the counterpart, the messages and the receipts; marks the newest as read', () => {
    const p = setup();
    expect(screen.getByTestId('chat-title').textContent).toBe('حيدر');
    expect(screen.getByTestId('chat-msg-1').textContent).toContain('وصلت');
    expect(screen.getByTestId('chat-msg-2').textContent).toContain('chat.read');
    expect(p.markRead).toHaveBeenCalledWith(2);
  });

  it('sends typed text and a quick reply with a client id', async () => {
    const p = setup();
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'هلا' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-send'));
    });
    expect(p.send).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord_abc123', kind: 'customer_courier', text: 'هلا', clientId: expect.stringMatching(/^m-/) }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('qr-courier_two_min'));
    });
    expect(p.send).toHaveBeenLastCalledWith(expect.objectContaining({ quickReplyKey: 'courier_two_min' }));
    expect(p.refresh).toHaveBeenCalled();
  });

  it('the kitchen has no location button; a closed thread has no composer', () => {
    setup({}, view({ status: 'closed' }));
    expect(screen.queryByTestId('chat-location')).toBeNull();
    expect(screen.getByTestId('chat-closed')).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('location appears when the app can read the position, and a call goes through the header', async () => {
    const currentLocation = vi.fn(async () => ({ lat: 32.9, lng: 45.06 }));
    const p = setup({ currentLocation });
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-location'));
    });
    expect(p.send).toHaveBeenCalledWith(expect.objectContaining({ location: { lat: 32.9, lng: 45.06 } }));
    fireEvent.click(screen.getByTestId('chat-call'));
    expect(p.call).toHaveBeenCalled();
  });

  it('the support chat is titled for the support team, invites the first message, and has no call', () => {
    const support = view({
      kind: 'customer_support',
      participants: [
        { role: 'customer', name: 'علي', you: true },
        { role: 'support', name: null, you: false },
      ],
      messages: [],
      lastSeq: 0,
      unread: 0,
      quickReplies: ['customer_support_late', 'customer_support_money'],
      canCall: false,
    });
    setup({ kind: 'customer_support', orderNumber: '1284' }, support);
    expect(screen.getByTestId('chat-title').textContent).toBe('chat.support_title');
    expect(screen.getByTestId('chat-support-empty').textContent).toContain('chat.support_empty_title');
    expect(screen.getByTestId('qr-customer_support_late')).toBeTruthy();
    expect(screen.queryByTestId('chat-call')).toBeNull();
  });

  describe('voice notes (ride ideas n7/n8)', () => {
    /** An app's microphone and player as fakes; `elapsedMs` is what the recorder reports. */
    function fakeVoice(over: { permission?: MicPermission; durationMs?: number } = {}) {
      const recorder = {
        permission: vi.fn(async (): Promise<MicPermission> => over.permission ?? 'granted'),
        requestPermission: vi.fn(async (): Promise<MicPermission> => 'granted'),
        openSettings: vi.fn(),
        start: vi.fn(async () => true),
        stop: vi.fn(async () => ({ uri: 'blob:voice-1', durationMs: over.durationMs ?? 4200, contentType: 'audio/webm' as const })),
        cancel: vi.fn(async () => undefined),
        elapsedMs: 0,
      };
      const player = { activeId: null as string | null, state: 'idle' as const, positionSec: 0, toggle: vi.fn(), stop: vi.fn() };
      const voice: ChatVoice = { recorder, player, upload: vi.fn(async () => 'up_voice'), audioUri: (u) => `https://api.test${u}` };
      return voice;
    }
    const mic = () => screen.getByTestId('chat-mic');
    /** Press, (slide by `dx`,) release: the responder system reads mouse events in the browser. */
    async function hold(dx = 0, release = true) {
      await act(async () => {
        fireEvent.mouseDown(mic(), { pageX: 200, clientX: 200, button: 0 });
      });
      if (dx) {
        await act(async () => {
          fireEvent.mouseMove(document, { pageX: 200 + dx, clientX: 200 + dx, buttons: 1 });
        });
      }
      if (release) {
        await act(async () => {
          fireEvent.mouseUp(document, { pageX: 200 + dx, clientX: 200 + dx });
        });
      }
    }

    it('the mic stands in for send while the field is empty', () => {
      const voice = fakeVoice();
      setup({ voice });
      expect(mic()).toBeTruthy();
      expect(screen.queryByTestId('chat-send')).toBeNull();
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'هلا' } });
      expect(screen.queryByTestId('chat-mic')).toBeNull();
      expect(screen.getByTestId('chat-send')).toBeTruthy();
    });

    it('is left out of the kitchen’s threads', () => {
      setup({ voice: fakeVoice(), kind: 'customer_merchant' }, view({ kind: 'customer_merchant' }));
      expect(screen.queryByTestId('chat-mic')).toBeNull();
    });

    it('hold records with a live counter, release uploads and sends the note with its length', async () => {
      const voice = fakeVoice();
      const p = setup({ voice });
      await hold(0, false);
      expect(voice.recorder.start).toHaveBeenCalled();
      expect(voice.player.stop).toHaveBeenCalled();
      expect(screen.getByTestId('chat-voice-recording')).toBeTruthy();
      expect(screen.getByTestId('chat-voice-elapsed').textContent).toBe('0:00');
      await act(async () => {
        fireEvent.mouseUp(document, { pageX: 200, clientX: 200 });
      });
      expect(voice.recorder.stop).toHaveBeenCalled();
      expect(voice.upload).toHaveBeenCalledWith(expect.objectContaining({ uri: 'blob:voice-1', contentType: 'audio/webm' }));
      expect(p.send).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'ord_abc123', kind: 'customer_courier', voiceUploadId: 'up_voice', durationSec: 5 }));
      expect(screen.queryByTestId('chat-voice-recording')).toBeNull();
    });

    it('sliding towards the start side cancels; nothing is sent', async () => {
      const voice = fakeVoice();
      const p = setup({ voice });
      // Arabic: the start side is the right.
      await hold(VOICE_CANCEL_SLIDE_PX + 10);
      expect(voice.recorder.cancel).toHaveBeenCalled();
      expect(voice.recorder.stop).not.toHaveBeenCalled();
      expect(p.send).not.toHaveBeenCalled();
    });

    it('a tap is not a note: too short sends nothing and says to hold', async () => {
      const voice = fakeVoice({ durationMs: 200 });
      const p = setup({ voice });
      await hold();
      expect(voice.upload).not.toHaveBeenCalled();
      expect(p.send).not.toHaveBeenCalled();
      expect(screen.getByText('chat.voice.hold_hint')).toBeTruthy();
    });

    it('the first hold explains before the OS asks; a refusal offers the settings', async () => {
      const voice = fakeVoice({ permission: 'undetermined' });
      (voice.recorder.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce('denied');
      setup({ voice });
      await hold();
      expect(voice.recorder.start).not.toHaveBeenCalled();
      expect(screen.getByTestId('chat-mic-prompt').textContent).toContain('chat.voice.mic_title');
      await act(async () => {
        fireEvent.click(screen.getByText('chat.voice.mic_allow'));
      });
      expect(voice.recorder.requestPermission).toHaveBeenCalled();
      expect(screen.getByTestId('chat-mic-prompt').textContent).toContain('chat.voice.mic_denied_title');
      await act(async () => {
        fireEvent.click(screen.getByText('chat.voice.open_settings'));
      });
      expect(voice.recorder.openSettings).toHaveBeenCalled();
    });

    it('draws voice bubbles with their seconds, plays through the one player, and says when a note went with the chat', () => {
      const voice = fakeVoice();
      const at = new Date();
      const note = (id: string, seq: number, audioUrl: string | null) => ({ id, seq, senderRole: 'courier' as const, mine: false, kind: 'voice' as const, text: null, quickReplyKey: null, photoUrl: null, audioUrl, durationSec: 12, location: null, masked: false, createdAt: at, read: false });
      setup({ voice }, view({ messages: [note('v1', 1, '/files/up_1?exp=1&sig=s'), note('v2', 2, null)], lastSeq: 2 }));
      expect(screen.getByTestId('chat-voice-v1-clock').textContent).toBe('0:12');
      fireEvent.click(screen.getByTestId('chat-voice-v1-toggle'));
      expect(voice.player.toggle).toHaveBeenCalledWith('v1', 'https://api.test/files/up_1?exp=1&sig=s');
      expect(screen.getByTestId('chat-voice-v2').textContent).toContain('chat.voice.expired');
    });
  });
});
