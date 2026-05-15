// The agentic chat panel that replaces FormPane on /designer/*. Owns its
// own React state (UI thread, input, slash menu) and dispatches store
// mutations via useAgentChat.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/editor/store';
import { Icon } from './Icon';
import { Suggestions } from './Suggestions';
import { StartersButton } from './StartersButton';
import { ActionCard } from './ActionCard';
import { SlashMenu } from './SlashMenu';
import { Checkpoint } from './Checkpoint';
import { expandSlash, type SlashCommand } from './expandSlash';
import {
  useAgentChat,
  type UIMessage,
  type UIAgentMessage,
  type UseAgentChatOpts,
} from './useAgentChat';
import styles from './AgentChatPane.module.css';

export function AgentChatPane({
  chatOpts,
  initialPrompt,
}: {
  chatOpts?: UseAgentChatOpts;
  // When provided, the chat fires this string as the first user turn
  // immediately after mount — used by the Start page to flow the user's
  // homepage prompt straight into the agent without a manual submit.
  initialPrompt?: string;
} = {}) {
  const selectedWord = useEditor((s) => s.selectedWord);
  const clearSelectedWord = useEditor((s) => s.clearSelectedWord);
  const chatPrefill = useEditor((s) => s.chatPrefill);
  const setChatPrefill = useEditor((s) => s.setChatPrefill);
  const chat = useAgentChat(chatOpts);
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef<boolean>(false);

  // Auto-scroll to the latest message.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages, chat.sending]);

  // Fire the homepage prompt as the first chat turn once on mount.
  useEffect(() => {
    if (autoSentRef.current) return;
    const text = initialPrompt?.trim();
    if (!text || chat.sending || chat.messages.length > 0) return;
    autoSentRef.current = true;
    chat.send({ text, expanded: text });
    // chat.send / chat.messages are stable refs from useAgentChat; we only
    // want to evaluate this once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // When something outside the chat (e.g. WordStyler "ask agent" CTA)
  // requests a prefilled prompt, drop it into the textarea and focus.
  useEffect(() => {
    if (chatPrefill) {
      setValue(chatPrefill);
      setChatPrefill(null);
      // Defer focus so the textarea has the new value.
      queueMicrotask(() => taRef.current?.focus());
    }
  }, [chatPrefill, setChatPrefill]);

  const showSlash = value.startsWith('/');

  function doSend() {
    const raw = value.trim();
    if (!raw || chat.sending) return;
    const exp = expandSlash(raw);
    if (exp.kind === 'revert') {
      chat.revertLast();
      setValue('');
      return;
    }
    const expanded = exp.kind === 'send' ? exp.text : exp.text;
    chat.send({
      text: raw,
      expanded,
      attachedWord: selectedWord ?? undefined,
      slashSource: exp.kind === 'send' ? exp.original : undefined,
    });
    setValue('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      doSend();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !showSlash) {
      e.preventDefault();
      doSend();
      return;
    }
    if (e.key === 'Enter' && showSlash) {
      e.preventDefault();
      // Pick the first match.
      const exp = expandSlash(value.trim());
      if (exp.kind === 'send' || exp.kind === 'revert') {
        doSend();
      }
    }
  }

  function pickSlash(c: SlashCommand) {
    setValue(c.cmd + (c.arg ? ' ' : ''));
    taRef.current?.focus();
  }

  return (
    <div className={styles.chat}>
      <div className={styles.chatHead}>
        <div className="title">
          <div className={styles.agentMark}>A</div>
          <div>
            <div className={styles.agentName}>Atelier</div>
            <div className={styles.agentSub}>Caption Agent · v0.1</div>
          </div>
        </div>
        <div className="actions">
          <StartersButton />
          <button type="button" className={styles.iconBtn} title="History">
            <Icon name="history" size={14} />
          </button>
          <button type="button" className={styles.iconBtn} title="More">
            <Icon name="more" size={14} />
          </button>
        </div>
      </div>

      <div className={styles.branchBar}>
        <Icon name="branch" size={13} />
        <span className={styles.crumb}>main</span>
        <span className={styles.arr}>/</span>
        <span className={`${styles.crumb} ${styles.cur}`}>
          {chat.threadId.slice(0, 8)}
        </span>
        <span className={styles.grow} />
        <button type="button" className={styles.fork} title="Fork branch (V2)">
          + FORK
        </button>
      </div>

      <div className={styles.chatBody} ref={bodyRef}>
        {chat.messages.length === 0 && (
          <Suggestions
            onPick={(prompt) => {
              chat.send({
                text: prompt,
                expanded: prompt,
                attachedWord: selectedWord ?? undefined,
              });
            }}
          />
        )}

        {(() => {
          // Render messages with checkpoint markers between agent turns.
          // Cp 0 sits at the top of the thread; subsequent cps sit AFTER each
          // agent reply (mirrors the prototype's data shape).
          const rendered: React.ReactNode[] = [];
          let cpNum = 0;
          if (chat.messages.length > 0) {
            rendered.push(
              <Checkpoint key="cp-0" num={cpNum++} label="Imported · Cinematic preset" />,
            );
          }
          for (const m of chat.messages as UIMessage[]) {
            if (m.kind === 'user') {
              rendered.push(
                <div key={m.id} className={styles.msgUser}>
                  {m.attachedWord && (
                    <span className={styles.refTag}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 7,
                          height: 7,
                          borderRadius: 2,
                          background: 'var(--ag-ai)',
                          marginRight: 2,
                        }}
                      />
                      @"{m.attachedWord.text}"
                    </span>
                  )}
                  {m.slashSource ? (
                    <>
                      <span style={{ fontFamily: 'var(--ag-font-mono)', fontSize: 11.5, color: 'var(--ag-ai)' }}>
                        {m.slashSource}
                      </span>
                      {' — '}
                      {m.text.replace(m.slashSource, '').trim() || (
                        <span style={{ color: 'var(--ag-ink-3)' }}>(expanded)</span>
                      )}
                    </>
                  ) : (
                    m.text
                  )}
                </div>,
              );
            } else {
              rendered.push(
                <ActionCard
                  key={m.id}
                  msg={m}
                  onTweak={(am: UIAgentMessage) => {
                    setValue(
                      `tweak the previous change (${am.assistantMessage.replace(/[.!]$/, '')}): `,
                    );
                    taRef.current?.focus();
                  }}
                  onReject={(am: UIAgentMessage) => chat.revertAt(am.id)}
                />,
              );
              // Derive a short cp label from the agent's reply.
              const label = m.assistantMessage
                .replace(/^([A-Z][a-z]+ed|[A-Z][a-z]+|Pumped|Cranked|Locked|Eased|Held)/, '')
                .replace(/[.!]$/, '')
                .trim() || `Turn ${cpNum}`;
              rendered.push(
                <Checkpoint
                  key={`cp-${m.id}`}
                  num={cpNum++}
                  label={label.slice(0, 60)}
                  onRevert={() => chat.revertAt(m.id)}
                />,
              );
            }
          }
          return rendered;
        })()}

        {chat.sending && (
          <div className={styles.msgAgent}>
            <div className={styles.av} aria-hidden="true" />
            <div className={styles.body}>
              <div className={styles.applied} style={{ color: 'var(--ag-ink-3)' }}>
                Thinking…
              </div>
            </div>
          </div>
        )}

        {chat.error && (
          <div className={styles.errorBar}>
            {chat.error}
            <button
              type="button"
              onClick={chat.clearError}
              style={{ float: 'right', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
            >
              <Icon name="x" size={10} />
            </button>
          </div>
        )}
      </div>

      <div className={styles.chatFoot}>
        {selectedWord && (
          <div className={styles.attachedRow}>
            <div className={`${styles.attachedChip} ${styles.word}`}>
              <span className={styles.swatch} style={{ background: 'var(--ag-ai)' }} />
              @"{selectedWord.text}" · {selectedWord.t.toFixed(2)}s
              <button
                type="button"
                className={styles.x}
                onClick={() => clearSelectedWord()}
                aria-label="Clear selection"
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          </div>
        )}
        <div className={styles.inputWrap}>
          {showSlash && <SlashMenu filter={value} onPick={pickSlash} />}
          <textarea
            ref={taRef}
            rows={2}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              selectedWord
                ? `Edit "${selectedWord.text}" — what should change?`
                : 'Ask the agent. Type / for commands.'
            }
            disabled={chat.sending}
          />
          <div className={styles.inputControls}>
            <button
              type="button"
              className={`${styles.icBtn}${selectedWord ? ' ' + styles.on : ''}`}
              title="Point & prompt — click a word on the timeline below"
              onClick={() => clearSelectedWord()}
            >
              <Icon name="at" size={12} /> POINT
            </button>
            <button
              type="button"
              className={styles.icBtn}
              title="Attach style reference (V2)"
              disabled
            >
              <Icon name="image" size={12} /> REF
            </button>
            <button
              type="button"
              className={styles.icBtn}
              title="Anchor to time (V2)"
              disabled
            >
              <Icon name="clock" size={12} /> @TIME
            </button>
            <button
              type="button"
              className={styles.icBtn}
              onClick={() => setValue('/')}
              title="Slash commands"
            >
              <Icon name="paper" size={12} /> /
            </button>
            <span className={styles.grow} />
            <span className={styles.kbdHint}>⌘↵</span>
            <button
              type="button"
              className={styles.sendBtn}
              disabled={!value.trim() || chat.sending}
              onClick={doSend}
            >
              SEND <Icon name="send" size={11} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
