'use client';

// Plot reservation thread — the 0004 claim-scoped chat surfaced on the web.
// RLS is the authority: only the grower and the approved buyer can read or
// write, growth updates ('update' kind) are grower-only (0026 trigger), and
// photos must live in this project's public bucket. Completed reservations
// render read-only history.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabaseBrowser';

interface Msg {
  id: string;
  sender_id: string;
  body: string;
  kind: 'message' | 'update';
  photo_url: string | null;
  created_at: string;
}

async function toJpeg(file: File, maxDim = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85));
}

export default function PlotThread({
  claimId,
  isGrower,
  readOnly = false,
}: {
  claimId: string;
  isGrower: boolean;
  readOnly?: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabaseBrowser().auth.getSession().then(({ data }) => setUid(data.session?.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()
      .from('claim_messages')
      .select('id,sender_id,body,kind,photo_url,created_at')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) setError(error.message);
    else setMsgs((data as Msg[]) ?? []);
  }, [claimId]);

  // Load now, then poll gently while the thread is open.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 12_000);
    return () => clearInterval(t);
  }, [load]);

  async function send(kind: 'message' | 'update') {
    if (busy || !uid) return;
    const text = body.trim() || (kind === 'update' ? 'Growth update 🌱' : '');
    if (!text) return setError('Write a message first.');
    setBusy(true);
    setError(null);
    try {
      const sb = supabaseBrowser();
      let photoUrl: string | null = null;
      if (kind === 'update' && photo) {
        const blob = await toJpeg(photo);
        const path = `${uid}/update-${Date.now()}.jpg`;
        const { error: upErr } = await sb.storage
          .from('listing-images')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw new Error(`Photo upload failed: ${upErr.message}`);
        photoUrl = sb.storage.from('listing-images').getPublicUrl(path).data.publicUrl;
      }
      const { error } = await sb.from('claim_messages').insert({
        claim_id: claimId,
        sender_id: uid,
        body: text,
        kind,
        photo_url: photoUrl,
      });
      if (error) {
        throw new Error(
          error.message.includes('rate limit')
            ? 'Slow down a little — 30 messages an hour per thread.'
            : error.message,
        );
      }
      setBody('');
      setPhoto(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (msgs === null) return <div className="thread"><p className="authhint">Loading thread…</p></div>;

  return (
    <div className="thread">
      <div className="chatlog">
        {msgs.length === 0 && (
          <p className="authhint" style={{ margin: 0 }}>
            {isGrower
              ? 'No messages yet — say hi, or post your first growth update. 🌱'
              : 'No messages yet — say hi and tell your grower what you’re excited about.'}
          </p>
        )}
        {msgs.map((m) => {
          const mine = m.sender_id === uid;
          if (m.kind === 'update') {
            return (
              <div key={m.id} className="growth-update">
                <div className="gu-head">🌱 Growth update · {new Date(m.created_at).toLocaleDateString()}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.photo_url && <img src={m.photo_url} alt="Growth update photo" loading="lazy" />}
                <p>{m.body}</p>
              </div>
            );
          }
          return (
            <div key={m.id} className={`bubble ${mine ? 'user' : 'assistant'}`}>
              {m.body}
            </div>
          );
        })}
      </div>

      {readOnly ? (
        <p className="authhint" style={{ marginTop: 10 }}>
          This reservation is complete — the thread is read-only history.
        </p>
      ) : (
        <div className="thread-composer">
          <input
            value={body}
            placeholder={isGrower ? 'Message, or describe this week’s growth…' : 'Message your grower…'}
            maxLength={500}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void send('message'); }}
          />
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void send('message')}>
            Send
          </button>
          {isGrower && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                title="Attach a photo and post as a growth update"
                onClick={() => (photo ? void send('update') : fileRef.current?.click())}
              >
                {photo ? (busy ? 'Posting…' : '🌱 Post update') : '📷 Growth update'}
              </button>
            </>
          )}
        </div>
      )}
      {photo && !busy && (
        <p className="authhint" style={{ marginTop: 6 }}>
          Photo attached: {photo.name} — add a note above, then “🌱 Post update”.
        </p>
      )}
      {error && <p className="autherror">{error}</p>}
    </div>
  );
}
