import {
  PhotoContentType,
  VoiceContentType,
  type DeliveryPoint,
  type ErrandItemSpec,
  type OrderLineInput,
  type PhotoUploadTicket,
  type PlaceOrderInput,
} from '@driver/contracts';
import { API_URL } from '@/lib/api';
import { absoluteUrl } from '@/features/account/geo';
import type { ErrandDraft, ErrandItem } from './errand';

type Ticket = (input: {
  contentType: PhotoContentType | VoiceContentType;
  sizeBytes: number;
}) => Promise<PhotoUploadTicket>;

/** The type the server checks a file against: what the file says it is, or the recorder's / camera's usual. */
function typeOf(blobType: string, kind: 'photo' | 'voice'): PhotoContentType | VoiceContentType {
  const base = blobType.split(';')[0]?.trim() ?? '';
  if (kind === 'photo')
    return PhotoContentType.safeParse(base).success ? (base as PhotoContentType) : 'image/jpeg';
  return VoiceContentType.safeParse(base).success ? (base as VoiceContentType) : 'audio/mp4';
}

/** Puts one local photo or voice note in our upload store; returns its upload id. Throws when it fails. */
export async function uploadErrandMedia(
  uri: string,
  kind: 'photo' | 'voice',
  requestTicket: Ticket,
): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  if (blob.size === 0) throw new Error('upload_empty');
  const ticket = await requestTicket({
    contentType: typeOf(blob.type, kind),
    sizeBytes: blob.size,
  });
  const put = await fetch(absoluteUrl(ticket.uploadUrl, API_URL), {
    method: ticket.method,
    headers: ticket.headers,
    body: blob,
  });
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return ticket.uploadId;
}

export interface ErrandUploads {
  photo: Map<string, string>;
  voice: Map<string, string>;
}

/**
 * The list as errand lines: the words in `freeText` (a short stand-in when the item is only a voice
 * note or a photo), and how much, from where, what to do if missing, the top price and the uploads in
 * `errandItem`. A shop the customer knows travels by name and pin only; nothing about people.
 */
export function errandLines(
  draft: ErrandDraft,
  uploads: ErrandUploads,
  words: { byVoice: string; byPhoto: string },
): OrderLineInput[] {
  return draft.items.map((item: ErrandItem): OrderLineInput => {
    const what = item.what.trim() || (item.voice ? words.byVoice : words.byPhoto);
    const voiceUploadId = uploads.voice.get(item.id) ?? null;
    const spec: ErrandItemSpec = {
      unit: item.unit,
      where:
        item.where.kind === 'app'
          ? { kind: 'app', shopId: item.where.shopId }
          : item.where.kind === 'known'
            ? { kind: 'known', name: item.where.name.trim(), pin: item.where.pin }
            : { kind: 'near' },
      ifMissing: item.ifMissing,
      maxIqd: item.maxIqd,
      photoUploadId: uploads.photo.get(item.id) ?? null,
      voiceUploadId,
      voiceSec:
        voiceUploadId && item.voice ? Math.max(1, Math.ceil(item.voice.durationMs / 1000)) : null,
      listMaxIqd: draft.ceilingIqd,
    };
    return {
      freeText: what.slice(0, 300),
      qty: Math.min(99, Math.max(1, Math.round(item.qty))),
      errandItem: spec,
    };
  });
}

/** دوّرلي as an `errand` order: the shopper starts near the customer (shops nearby) and brings it to the door; cash. */
export function errandOrderInput(input: {
  cityId: string;
  lines: OrderLineInput[];
  dropoff: DeliveryPoint;
}): PlaceOrderInput {
  return {
    cityId: input.cityId,
    type: 'errand',
    lines: input.lines as PlaceOrderInput['lines'],
    participants: [],
    tipIqd: 0,
    paymentMethod: 'cash',
    pickup: input.dropoff,
    dropoff: input.dropoff,
  } as PlaceOrderInput;
}
