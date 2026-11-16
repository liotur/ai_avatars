import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArchitectureDiagram } from '../components/ArchitectureDiagram';
import { Icon } from '../components/Icon';
import { useDocumentTitle } from '../useDocumentTitle';

type ActorKind = 'ui' | 'assistant' | 'data' | 'model';

const PARTS: Array<{ kind: ActorKind; name: string; job: string }> = [
  { kind: 'ui', name: 'Web UI', job: 'The library and the chat. Talks REST only.' },
  { kind: 'assistant', name: 'Assistant', job: 'Owns the prompts, the loop, and the memory of the chat. The only part that holds the model key.' },
  { kind: 'data', name: 'Avatar MCP', job: 'Three tools for the assistant: list, get, create. No edit, no delete.' },
  { kind: 'data', name: 'Avatar manager', job: 'Stores avatars and checks them. Knows nothing about models.' },
];

function Actor({ kind, children }: { kind: ActorKind; children: ReactNode }) {
  return <span className={`actor actor-${kind}`}>{children}</span>;
}

/** Who talks to whom in a step. */
function Hop({ from, to }: { from: [ActorKind, string]; to: [ActorKind, string] }) {
  return (
    <p className="hop">
      <Actor kind={from[0]}>{from[1]}</Actor>
      <Icon name="arrow-right" />
      <Actor kind={to[0]}>{to[1]}</Actor>
    </p>
  );
}

/** One line of what goes out or comes back. */
function Wire({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wire">
      <span className="wire-label">{label}</span>
      <div className="wire-values">{children}</div>
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flow-step">
      <span className="flow-num" aria-hidden="true">
        {number}
      </span>
      <div className="flow-card">
        <h3>
          <span className="visually-hidden">Step {number}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

export function HowItWorksPage() {
  useDocumentTitle('How it works');

  return (
    <div className="how">
      <header className="page-head">
        <div>
          <p className="eyebrow">How it works</p>
          <h1>Four parts, one job each</h1>
          <p className="lede">The assistant decides who answers. It never touches the database, and the database never sees a model.</p>
        </div>
      </header>

      <ul className="parts">
        {PARTS.map((part) => (
          <li key={part.name} className={`part part-${part.kind}`}>
            <h2>{part.name}</h2>
            <p>{part.job}</p>
          </li>
        ))}
      </ul>

      <ArchitectureDiagram />

      <section className="how-section" aria-labelledby="flow-title">
        <p className="eyebrow">One question</p>
        <h2 id="flow-title" className="how-title">
          From your message to the answer
        </h2>

        <ol className="flow">
          <Step number={1} title="You ask">
            <Hop from={['ui', 'Chat page']} to={['assistant', 'Assistant']} />
            <Wire label="sends">
              <code>POST /v1/sessions/&#123;id&#125;/messages</code>
              <code>&#123; content, avatarId? &#125;</code>
            </Wire>
          </Step>

          <Step number={2} title="The assistant fetches the avatars">
            <Hop from={['assistant', 'Assistant']} to={['data', 'Avatar MCP']} />
            <Wire label="calls">
              <code>list_avatars</code>
            </Wire>
            <Wire label="gets">
              <code>id</code>
              <code>name</code>
              <code>description</code>
              <code>useWhen</code>
            </Wire>
            <p className="flow-note">The code makes this call, not the model, so it always happens.</p>
          </Step>

          <Step number={3} title="It decides who answers">
            <Hop from={['assistant', 'Assistant']} to={['model', 'Language model']} />
            <div className="call">
              <Wire label="system">
                <span>the rules for choosing or drafting</span>
              </Wire>
              <Wire label="user">
                <span>the avatars + the last turns + your message</span>
              </Wire>
            </div>
            <ul className="outcomes">
              <li className="outcome">
                <span className="badge">
                  <Icon name="user" />
                  requested
                </span>
                <p>You picked an avatar.</p>
                <p className="flow-note">No model call.</p>
              </li>
              <li className="outcome">
                <span className="badge">
                  <Icon name="target" />
                  chosen
                </span>
                <p>One fits.</p>
                <code>&#123; "decision": "choose", avatarId, reason &#125;</code>
              </li>
              <li className="outcome">
                <span className="badge badge-accent">
                  <Icon name="sparkles" />
                  created
                </span>
                <p>None fits.</p>
                <code>&#123; "decision": "propose", draft, reason &#125;</code>
                <p className="flow-note">
                  Then <code>create_avatar</code> saves it to the library.
                </p>
              </li>
            </ul>
            <p className="flow-note">
              A follow-up stays with the avatar that answered last. An unusable reply gets one retry, with the reason
              sent back to the model.
            </p>
          </Step>

          <Step number={4} title="It loads that avatar">
            <Hop from={['assistant', 'Assistant']} to={['data', 'Avatar MCP']} />
            <Wire label="calls">
              <code>get_avatar</code>
            </Wire>
            <Wire label="gets">
              <code>perspective</code>
              <code>voice</code>
              <code>caresAbout</code>
              <code>ignores</code>
              <code>intensity</code>
            </Wire>
            <ul className="dial" aria-label="What intensity changes">
              <li>
                <strong>subtle</strong>
                <span>its priorities, plain wording</span>
              </li>
              <li>
                <strong>balanced</strong>
                <span>priorities + its voice</span>
              </li>
              <li>
                <strong>immersive</strong>
                <span>fully in character</span>
              </li>
            </ul>
          </Step>

          <Step number={5} title="The avatar writes a draft">
            <Hop from={['assistant', 'Assistant']} to={['model', 'Language model']} />
            <div className="call">
              <Wire label="system">
                <span>the avatar, as instructions</span>
              </Wire>
              <Wire label="user">
                <span>the conversation so far + your message</span>
              </Wire>
            </div>
            <p className="flow-note">You watch it being written, marked as thinking. It is not the answer yet.</p>
          </Step>

          <Step number={6} title="The draft is validated">
            <Hop from={['assistant', 'Assistant']} to={['model', 'Language model']} />
            <div className="call">
              <Wire label="system">
                <span>the four checks</span>
              </Wire>
              <Wire label="user">
                <span>the avatar + your message + the draft</span>
              </Wire>
            </div>
            <ul className="dial" aria-label="What is checked">
              <li>
                <strong>answers</strong>
                <span>it answers what you asked</span>
              </li>
              <li>
                <strong>sound</strong>
                <span>nothing clearly false</span>
              </li>
              <li>
                <strong>stance</strong>
                <span>the avatar's priorities</span>
              </li>
              <li>
                <strong>voice</strong>
                <span>wording fits the intensity</span>
              </li>
            </ul>
            <ul className="outcomes">
              <li className="outcome">
                <span className="badge badge-ok">
                  <Icon name="check" />
                  validated
                </span>
                <p>All four pass.</p>
                <p className="flow-note">The draft becomes the answer.</p>
              </li>
              <li className="outcome">
                <span className="badge badge-warn">
                  <Icon name="refresh" />
                  rewritten after validation
                </span>
                <p>One fails.</p>
                <p className="flow-note">The avatar writes it again, once, with the advice.</p>
              </li>
              <li className="outcome">
                <span className="badge">
                  <Icon name="alert" />
                  not validated
                </span>
                <p>The check could not run.</p>
                <p className="flow-note">The draft becomes the answer, with this label.</p>
              </li>
            </ul>
          </Step>

          <Step number={7} title="You get the answer">
            <Hop from={['assistant', 'Assistant']} to={['ui', 'Chat page']} />
            <Wire label="streams">
              <code>avatar</code>
              <Icon name="arrow-right" />
              <code>stage</code>
              <Icon name="arrow-right" />
              <code>draft</code>
              <code>…</code>
              <Icon name="arrow-right" />
              <code>evaluation</code>
              <Icon name="arrow-right" />
              <code>delta</code>
              <code>…</code>
              <Icon name="arrow-right" />
              <code>done</code>
            </Wire>
            <p className="flow-note">
              <code>avatar</code> says who is answering and why, <code>stage</code> what is happening, each{' '}
              <code>draft</code> is a piece of the thinking, <code>evaluation</code> how the validation went, and each{' '}
              <code>delta</code> is the answer. The assistant then remembers the exchange, so the next message can follow
              up.
            </p>
          </Step>
        </ol>
      </section>

      <div className="empty-actions">
        <Link className="button button-primary" to="/chat">
          <Icon name="message" />
          Try it in chat
        </Link>
        <Link className="button button-quiet" to="/avatars">
          Open the library
        </Link>
      </div>
    </div>
  );
}
