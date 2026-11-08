import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IonIcon } from '@ionic/react';
import { chatbubbleEllipsesOutline, closeOutline, sendOutline } from 'ionicons/icons';
import { useAuth } from '../contexts/AuthContext';
import {
  fallbackFor,
  greeting,
  matchIntent,
  menuFor,
  suggestedFor,
  type Intent,
} from '../lib/chatbot';
import mascot from '../assets/icon-projects.png';
import './ChatBot.css';

/**
 * A turn in the conversation.
 *
 * Choices are a message rather than a fixed bar under the window. They arrive
 * in the thread the way an answer does, they are read in the order everything
 * else is read, and once one is taken it leaves with the reply, so the thread
 * shows what was asked instead of a row of buttons that never changes.
 */
type Message =
  | { id: number; kind: 'text'; from: 'bot' | 'user'; text: string }
  | { id: number; kind: 'options'; lead: string; expanded: boolean };

/** Screens with no session behind them, where the assistant has nothing to read. */
const PUBLIC_ROUTES = ['/', '/login', '/register', '/forgot-password'];

/**
 * Floating help assistant for the two acting roles.
 *
 * A button rather than a navigation entry: a question arrives in the middle of
 * doing something else, and sending someone to another page to ask it loses the
 * screen they were asking about.
 *
 * The answers come from lib/chatbot, which matches an intent against the set
 * for the caller's role and then reads that account's own rows. Nothing here is
 * generated text.
 *
 * The Admin is left out: every question this answers, an admin already has a
 * dashboard for.
 */
const ChatBot: React.FC = () => {
  const { role, profile } = useAuth();
  const location = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);

  const nextId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  const show = role === 'Customer' && !PUBLIC_ROUTES.includes(location.pathname);

  const suggested = suggestedFor(role);
  const menu = menuFor(role);

  const identify = () => {
    nextId.current += 1;
    return nextId.current;
  };

  const say = (from: 'bot' | 'user', text: string) =>
    setMessages((current) => [...current, { id: identify(), kind: 'text', from, text }]);

  const offer = (lead: string) =>
    setMessages((current) => [...current, { id: identify(), kind: 'options', lead, expanded: false }]);

  // The opening lines are written once, the first time the panel is opened, so
  // reopening it keeps the conversation rather than starting over.
  useEffect(() => {
    if (!isOpen || messages.length > 0 || !profile) return;
    say('bot', greeting(profile.name, role));
    offer('Pick a question');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, profile, role]);

  // A new answer is only useful if it is the part in view.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    if (!isOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const respond = async (intent: Intent | null) => {
    if (!profile) return;

    setThinking(true);

    try {
      const text = intent
        ? await intent.answer({ userId: profile.users_id, name: profile.name })
        : fallbackFor(role);
      say('bot', text);
    } catch {
      say('bot', 'Something went wrong while looking that up. Try again in a moment.');
    }

    setThinking(false);
    offer('Pick a question');
  };

  const ask = (text: string) => {
    if (!text.trim() || thinking) return;
    // A typed question retires whatever choices were on offer, the same as
    // picking one would.
    setMessages((current) => current.filter((message) => message.kind !== 'options'));
    say('user', text.trim());
    setDraft('');
    void respond(matchIntent(text, role));
  };

  const pick = (intent: Intent) => {
    if (thinking) return;
    setMessages((current) => current.filter((message) => message.kind !== 'options'));
    say('user', intent.label);
    void respond(intent);
  };

  const expand = (id: number) =>
    setMessages((current) =>
      current.map((message) =>
        message.id === id && message.kind === 'options' ? { ...message, expanded: true } : message
      )
    );

  if (!show) return null;

  return (
    <>
      <button
        type="button"
        className={`chatbot-fab${isOpen ? ' chatbot-fab--hidden' : ''}`}
        onClick={() => setIsOpen(true)}
        aria-label="Open the help assistant"
      >
        <IonIcon icon={chatbubbleEllipsesOutline} />
        <img src={mascot} alt="" className="chatbot-fab__mascot" />
      </button>

      {isOpen && (
        <section className="chatbot" role="dialog" aria-label="FarmVest help assistant">
          <header className="chatbot__head">
            <img src={mascot} alt="" className="chatbot__head-avatar" />

            <div className="chatbot__head-titles">
              <p className="chatbot__title">FarmVest Assistant</p>
              <p className="chatbot__status">Answers about your farm and this app</p>
            </div>

            <button
              type="button"
              className="chatbot__close"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              <IonIcon icon={closeOutline} />
            </button>
          </header>

          <div className="chatbot__body" ref={bodyRef}>
            {messages.map((message, index) => {
              if (message.kind === 'options') {
                const shown = message.expanded ? menu : suggested;

                return (
                  <div className="chatbot__options" key={message.id}>
                    <p className="chatbot__options-lead">{message.lead}</p>

                    {shown.map((intent) => (
                      <button
                        key={intent.id}
                        type="button"
                        className="chatbot__option"
                        disabled={thinking}
                        onClick={() => pick(intent)}
                      >
                        {intent.label}
                      </button>
                    ))}

                    {!message.expanded && (
                      <button
                        type="button"
                        className="chatbot__option chatbot__option--more"
                        onClick={() => expand(message.id)}
                      >
                        More questions
                      </button>
                    )}
                  </div>
                );
              }

              // The avatar marks who is speaking, so it belongs on the first
              // line of a run and would only repeat itself after that.
              const previous = messages[index - 1];
              const opensRun =
                !previous || previous.kind !== 'text' || previous.from !== message.from;

              return (
                <div className={`chatbot__row chatbot__row--${message.from}`} key={message.id}>
                  {message.from === 'bot' &&
                    (opensRun ? (
                      <img src={mascot} alt="" className="chatbot__avatar" />
                    ) : (
                      <span className="chatbot__avatar chatbot__avatar--spacer" />
                    ))}

                  <div className={`chatbot__msg chatbot__msg--${message.from}`}>{message.text}</div>
                </div>
              );
            })}

            {thinking && (
              <div className="chatbot__row chatbot__row--bot">
                <img src={mascot} alt="" className="chatbot__avatar" />
                <div className="chatbot__msg chatbot__msg--bot chatbot__typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          <form
            className="chatbot__compose"
            onSubmit={(event) => {
              event.preventDefault();
              ask(draft);
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Or type your question"
              aria-label="Your question"
            />
            <button type="submit" disabled={!draft.trim() || thinking} aria-label="Send">
              <IonIcon icon={sendOutline} />
            </button>
          </form>
        </section>
      )}
    </>
  );
};

export default ChatBot;
