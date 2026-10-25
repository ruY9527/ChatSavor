const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const extensionRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

function createPage(t, html, hostname = 'chatgpt.com', prepare) {
  const dom = new JSDOM(html, {
    url: `https://${hostname}/c/test`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  let now = 0;
  let timerId = 0;
  const timers = new Map();

  // Simulate layout boxes: jsdom deliberately does not implement browser layout.
  window.HTMLElement.prototype.getClientRects = function() {
    if (!this.isConnected || window.getComputedStyle(this).display === 'contents') return [];
    for (let node = this; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden') return [];
    }
    return [{ width: 200, height: 30 }];
  };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    get() { return this.getClientRects().length ? this.parentElement : null; },
  });

  window.Date.now = () => now;
  function schedule(callback, delay, repeat) {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay, repeat });
    return id;
  }
  window.setTimeout = (callback, delay) => schedule(callback, delay, 0);
  window.setInterval = (callback, delay) => schedule(callback, delay, delay);
  window.clearTimeout = window.clearInterval = id => timers.delete(id);
  if (prepare) prepare(window);

  for (const script of manifest.content_scripts[0].js) {
    const scriptPath = script.endsWith('/chatgpt.js') && process.env.CHATSAVOR_CHATGPT_SCRIPT
      ? process.env.CHATSAVOR_CHATGPT_SCRIPT
      : path.join(extensionRoot, script);
    window.eval(fs.readFileSync(scriptPath, 'utf8'));
  }
  document.dispatchEvent(new window.Event('DOMContentLoaded'));

  function advance(ms) {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.at;
      timers.delete(id);
      if (timer.repeat) timers.set(id, { ...timer, at: now + timer.repeat });
      timer.callback();
    }
    now = target;
  }

  return { window, document, advance, buttons: () => document.querySelectorAll('.ai-saver-host') };
}

test('classic replies still convert through the full content-script bootstrap', t => {
  const page = createPage(t, `<main>
    <article data-testid="conversation-turn-1" data-turn="user">
      <div data-message-author-role="user"><p>Do not export this question.</p></div>
    </article>
    <article data-testid="conversation-turn-2" data-turn="assistant">
      <div data-message-author-role="assistant"><div class="markdown">
        <h2>Answer</h2><p>This is the assistant response.</p>
        <pre><code class="language-js">const answer = 42;</code></pre>
        <table><tr><th>Key</th><th>Value</th></tr><tr><td>A</td><td>42</td></tr></table>
      </div></div>
    </article>
  </main>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 1);
  page.buttons()[0].shadowRoot.querySelector('button').click();
  const modal = page.document.querySelector('.ai-saver-modal-host');
  assert.ok(modal);
  const markdown = modal.shadowRoot.querySelector('.raw-md').textContent;
  assert.match(markdown, /## Answer/);
  assert.match(markdown, /```js\nconst answer = 42;/);
  assert.match(markdown, /\| Key \| Value \|/);
  assert.doesNotMatch(markdown, /Do not export this question/);
  page.advance(6000);
  assert.equal(page.buttons().length, 1, 'preview content must not get another conversion button');
});

test('short replies and data-turn layouts work alongside classic author-role layouts', t => {
  const page = createPage(t, `<main>
    <div data-message-author-role="assistant">A classic response with enough text.</div>
    <article data-testid="conversation-turn-2" data-turn="assistant"><div class="markdown">好的。</div></article>
    <article data-testid="conversation-turn-3" data-turn="user"><div class="markdown">用户问题</div></article>
    <div data-message-author-role="assistant">是。</div>
  </main>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 3);
});

test('role-less conversation turns keep split Markdown blocks under one button', t => {
  const page = createPage(t, `<main>
    <article data-testid="conversation-turn-1"><div data-message-author-role="user">Question</div></article>
    <article data-testid="conversation-turn-2"><div class="markdown"><p>First part.</p></div>
      <div class="markdown"><p>Second part.</p></div><button>Copy</button></article>
  </main>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 1);
  page.buttons()[0].shadowRoot.querySelector('button').click();
  const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
  assert.match(markdown, /First part/);
  assert.match(markdown, /Second part/);
  assert.doesNotMatch(markdown, /Question|Copy/);
});

test('restores a button removed by a page re-render without duplicating it', t => {
  const page = createPage(t, '<main><div data-message-author-role="assistant">A response that stays on the page.</div></main>');
  page.advance(6000);
  assert.equal(page.buttons().length, 1);
  page.buttons()[0].remove();
  page.advance(2000);
  assert.equal(page.buttons().length, 1);
  page.advance(10000);
  assert.equal(page.buttons().length, 1);
});

test('streaming only delays the current reply, including icon-only stop controls', t => {
  const page = createPage(t, `<main>
    <div data-message-author-role="assistant">An earlier completed response.</div>
    <div id="current" data-message-author-role="assistant">A response currently being generated.</div>
    <button data-testid="stop-button"><svg></svg></button>
  </main>`);
  page.advance(10000);
  assert.equal(page.buttons().length, 1);
  assert.equal(page.buttons()[0].previousElementSibling.textContent, 'An earlier completed response.');
  page.document.querySelector('[data-testid="stop-button"]').remove();
  page.advance(4000);
  assert.equal(page.buttons().length, 2);
});

test('a local streaming marker delays injection even without a stop button', t => {
  const page = createPage(t, '<main><div data-message-author-role="assistant" data-is-streaming="true">Still generating this response.</div></main>');
  page.advance(6000);
  assert.equal(page.buttons().length, 0);
  page.document.querySelector('[data-is-streaming]').setAttribute('data-is-streaming', 'false');
  page.advance(4000);
  assert.equal(page.buttons().length, 1);
});

test('mixed reply layouts still identify the last reply in document order as streaming', t => {
  const page = createPage(t, `<main>
    <article data-testid="conversation-turn-1" data-turn="assistant"><p>An earlier response in a turn layout.</p></article>
    <div data-message-author-role="assistant">A later response in an author-role layout.</div>
    <button aria-label="Stop generating"></button>
  </main>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 1);
  assert.equal(page.buttons()[0].previousElementSibling.tagName, 'ARTICLE');
  page.document.querySelector('[aria-label="Stop generating"]').remove();
  page.advance(4000);
  assert.equal(page.buttons().length, 2);
});

test('text replacements of the same length restart the stability window', t => {
  const page = createPage(t, '<main><div data-message-author-role="assistant">A sufficiently long original reply.</div></main>');
  page.advance(2000);
  const reply = page.document.querySelector('[data-message-author-role]');
  reply.textContent = reply.textContent.replace('original', 'modified');
  page.advance(2000);
  assert.equal(page.buttons().length, 0);
  page.advance(2000);
  assert.equal(page.buttons().length, 1);
});

test('display:contents wrappers work; hidden replies and composer content are ignored', t => {
  const page = createPage(t, `<main>
    <div id="visible-reply" data-message-author-role="assistant" style="display:contents"><p>Visible answer in a box-less wrapper.</p></div>
    <div hidden><div data-message-author-role="assistant">Hidden answer should have no button.</div></div>
    <div aria-hidden="true" data-message-author-role="assistant">Invisible accessibility copy.</div>
    <form data-testid="composer"><div data-message-author-role="assistant">Draft text in the composer.</div></form>
    <div class="markdown">Unrelated Markdown outside the conversation.</div>
  </main>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 1);
  assert.equal(page.buttons()[0].previousElementSibling.id, 'visible-reply');
});

test('discovers replies after client-side conversation navigation on the legacy domain', t => {
  const page = createPage(t, '<main></main>', 'chat.openai.com');
  page.advance(6000);
  assert.equal(page.buttons().length, 0);
  page.document.querySelector('main').innerHTML = '<article data-turn="assistant"><p>New conversation response.</p></article>';
  page.advance(4000);
  assert.equal(page.buttons().length, 1);
});

test('generic platforms use the same math extraction and preview as dedicated adapters', t => {
  const page = createPage(t, String.raw`<main><div class="font-claude-message"><p>A completed response with the formula
    <span class="katex"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x_i^2+\alpha</annotation></semantics></math><span class="katex-html" aria-hidden="true">duplicate visual</span></span>.</p></div></main>`, 'claude.ai');
  page.advance(10000);
  assert.equal(page.buttons().length, 1);
  page.buttons()[0].shadowRoot.querySelector('button').click();
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.match(shadow.querySelector('.raw-md').textContent, /\$x_i\^2\+\\alpha\$/);
  assert.doesNotMatch(shadow.querySelector('.raw-md').textContent, /duplicate visual/);
  assert.equal(shadow.querySelectorAll('math').length, 1);
  assert.equal(shadow.querySelectorAll('.formula-item').length, 1);
});

test('a page-level form does not hide assistant replies outside the actual composer', t => {
  const page = createPage(t, `<form><main><article data-turn="assistant"><p>The completed assistant reply.</p></article></main>
    <div data-testid="composer"><div contenteditable="true" data-message-author-role="assistant">Draft composer text.</div></div></form>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 1);
  assert.equal(page.buttons()[0].previousElementSibling.tagName, 'ARTICLE');
});

test('unrecognized layouts do not create a floating control; selected content can convert through the popup bridge', t => {
  const page = createPage(t, '<main><section class="unknown-layout"><h2>Answer</h2><p>A reply in an unrecognized layout.</p></section></main>');
  page.advance(1000);
  assert.equal(page.buttons().length, 0);
  assert.equal(page.document.getElementById('chatsavor-launcher'), null);
  const range = page.document.createRange();
  range.selectNodeContents(page.document.querySelector('.unknown-layout'));
  page.window.getSelection().addRange(range);
  page.window.ChatSavorBridge.handle('SELECTION');
  const shadow = page.document.querySelector('.ai-saver-modal-host').shadowRoot;
  assert.match(shadow.querySelector('.raw-md').textContent, /## Answer/);
  assert.match(shadow.querySelector('.raw-md').textContent, /unrecognized layout/);
});

test('manual scanning can display buttons without waiting for automatic stability detection', t => {
  const page = createPage(t, '<main><div data-message-author-role="assistant">A reply ready for manual conversion.</div><button data-testid="stop-button"></button></main>');
  assert.equal(page.buttons().length, 0);
  const response = page.window.ChatSavorBridge.handle('SCAN');
  assert.equal(response.status.responseCount, 1);
  assert.equal(response.status.buttonCount, 1);
  assert.equal(page.document.getElementById('chatsavor-launcher'), null);
});

test('diagnostics expose loading and structural counts without conversation text or URL paths', t => {
  const page = createPage(t, '<main><div data-message-author-role="assistant">PRIVATE-CONVERSATION-CONTENT</div></main>');
  const status = page.window.ChatSavorBridge.status();
  assert.equal(status.host, 'chatgpt.com');
  assert.equal(status.adapter, 'chatgpt');
  assert.equal(status.counts.assistantRoles, 1);
  assert.equal(status.coreReady, true);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE-CONVERSATION-CONTENT|\/c\/test/);
});

test('reconnecting does not duplicate the bridge, adapter or reply buttons', t => {
  const page = createPage(t, '<main><div data-message-author-role="assistant">An existing response on an already open page.</div></main>');
  page.advance(6000);
  const bridge = page.window.ChatSavorBridge;
  const adapter = page.window.ChatSavorChatGPTAdapter;
  page.window.eval(fs.readFileSync(path.join(extensionRoot, 'src/content/bridge.js'), 'utf8'));
  page.window.eval(fs.readFileSync(path.join(extensionRoot, 'src/content/platforms/chatgpt.js'), 'utf8'));
  page.advance(6000);
  assert.equal(page.window.ChatSavorBridge, bridge);
  assert.equal(page.window.ChatSavorChatGPTAdapter, adapter);
  assert.equal(page.document.querySelectorAll('#chatsavor-launcher').length, 0);
  assert.equal(page.buttons().length, 1);
});

test('each assistant reply gets its own button and each click converts only that reply', t => {
  const page = createPage(t, `<main>
    <article data-testid="conversation-turn-1" data-turn="user"><p>User question.</p></article>
    <article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant"><p>First assistant reply.</p></div></article>
    <article data-testid="conversation-turn-3" data-turn="user"><p>Second user question.</p></article>
    <article data-testid="conversation-turn-4" data-turn="assistant"><div data-message-author-role="assistant"><p>Second assistant reply.</p></div></article>
    <article data-testid="conversation-turn-5" data-turn="assistant"><p>Third assistant reply in a different layout.</p></article>
  </main>`);
  page.advance(6000);
  assert.equal(page.buttons().length, 3);
  [...page.buttons()].forEach((host, index) => {
    assert.match(host.previousElementSibling.textContent, [/First assistant/, /Second assistant/, /Third assistant/][index]);
    assert.notEqual(host.style.position, 'fixed');
    host.shadowRoot.querySelector('button').click();
    const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
    assert.match(markdown, [/First assistant/, /Second assistant/, /Third assistant/][index]);
    assert.equal((markdown.match(/assistant reply/g) || []).length, 1);
    assert.doesNotMatch(markdown, /user question/i);
  });
  assert.equal(page.document.getElementById('chatsavor-launcher'), null);
});

test('finds replies in an iframe when all top-document response counts are zero', t => {
  const page = createPage(t, '<main><iframe></iframe></main>', 'chatgpt.com', window => {
    const frame = window.document.querySelector('iframe');
    frame.contentDocument.body.innerHTML = '<article data-turn="assistant"><div data-message-author-role="assistant">First framed reply.</div></article><article data-turn="assistant"><div data-message-author-role="assistant">Second framed reply.</div></article>';
    frame.contentWindow.HTMLElement.prototype.getClientRects = window.HTMLElement.prototype.getClientRects;
  });
  assert.equal(page.document.querySelectorAll('[data-message-author-role="assistant"]').length, 0);
  assert.equal(page.document.querySelectorAll('iframe').length, 1);
  page.advance(6000);
  const inner = page.document.querySelector('iframe').contentDocument;
  assert.equal(inner.querySelectorAll('.ai-saver-host').length, 2);
  assert.equal(page.window.ChatSavorBridge.status().responseCount, 2);
  inner.querySelector('.ai-saver-host').shadowRoot.querySelector('button').click();
  assert.equal(page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent, 'First framed reply.');
});

test('finds nested open and closed shadow-root replies through the extension DOM API', t => {
  let appRoot;
  const page = createPage(t, '<main><chat-app></chat-app></main>', 'chatgpt.com', window => {
    const closedRoots = new WeakMap();
    const app = window.document.querySelector('chat-app');
    appRoot = app.attachShadow({ mode: 'closed' });
    closedRoots.set(app, appRoot);
    appRoot.innerHTML = '<chat-thread></chat-thread>';
    const thread = appRoot.querySelector('chat-thread').attachShadow({ mode: 'open' });
    thread.innerHTML = '<article data-turn="user">Question.</article><article data-turn="assistant"><div data-message-author-role="assistant"><p>Nested reply.</p><span data-latex="x_i^2">x²</span></div></article>';
    window.chrome = { dom: { openOrClosedShadowRoot: element => closedRoots.get(element) || element.shadowRoot } };
  });
  assert.equal(page.document.querySelectorAll('[data-turn]').length, 0);
  page.advance(6000);
  const thread = appRoot.querySelector('chat-thread').shadowRoot;
  assert.equal(thread.querySelectorAll('.ai-saver-host').length, 1);
  assert.equal(page.window.ChatSavorBridge.status().structure.shadowRoots, 2);
  thread.querySelector('.ai-saver-host').shadowRoot.querySelector('button').click();
  const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
  assert.match(markdown, /Nested reply/);
  assert.match(markdown, /\$x_i\^2\$/);
  assert.doesNotMatch(markdown, /Question/);
});

test('a reply host with shadow content has only one button and exports its rendered content', t => {
  const page = createPage(t, '<main><chat-message data-turn="assistant"></chat-message></main>', 'chatgpt.com', window => {
    window.document.querySelector('chat-message').attachShadow({ mode: 'open' }).innerHTML = '<div data-message-author-role="assistant"><p>Content inside the component.</p></div>';
  });
  page.advance(6000);
  const status = page.window.ChatSavorBridge.status();
  assert.equal(status.responseCount, 1);
  assert.equal(status.buttonCount, 1);
  page.document.querySelector('.ai-saver-host').shadowRoot.querySelector('button').click();
  assert.equal(page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent, 'Content inside the component.');
});

test('2026 transcript list layout adds one button inside each assistant item and preserves math', t => {
  const page = createPage(t, String.raw`<main><ol data-conversation-transcript>
    <li data-message-role="user"><button data-user-message-bubble><p>Only the question.</p></button></li>
    <li data-message-role="assistant" data-message-complete>
      <h4 data-message-attribution>ChatGPT said:</h4>
      <div data-assistant-markdown><p>First new-layout reply.</p><p><span class="katex"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x_i^2+\alpha</annotation></semantics></math></span></p></div>
      <div data-assistant-message-actions data-message-actions><button>Copy response</button><span>Feedback controls</span></div>
    </li>
    <li data-message-role="user"><button data-user-message-bubble><p>Another question.</p></button></li>
    <li data-message-role="assistant" data-message-complete><h4 data-message-attribution>ChatGPT said:</h4><div data-assistant-markdown><p>好的。</p></div></li>
  </ol></main>`);
  assert.equal(page.document.querySelectorAll('[data-message-author-role], [data-turn], [data-testid^="conversation-turn-"], .markdown, .prose').length, 0);
  page.advance(6000);
  const replies = page.document.querySelectorAll('li[data-message-role="assistant"]');
  assert.equal(page.buttons().length, 2);
  assert.equal(page.document.querySelector('ol').children.length, 4, 'the transcript must still contain only its original message items');
  for (const reply of replies) assert.equal(reply.querySelectorAll(':scope > .ai-saver-host').length, 1);
  replies[0].querySelector('.ai-saver-host').shadowRoot.querySelector('button').click();
  const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
  assert.match(markdown, /First new-layout reply/);
  assert.match(markdown, /\$x_i\^2\+\\alpha\$/);
  assert.doesNotMatch(markdown, /ChatGPT said|Feedback controls|Only the question|Another question|好的/);
});

test('signed-in keyed layout separates each assistant unit from its prompt in the same turn', t => {
  const page = createPage(t, `<main><div data-app-action-timeline-scroll style="display:flex;flex-direction:column-reverse"><div>
    <div data-turn-key="turn-a"><div data-content-search-turn-key="turn-a">
      <div data-chatgpt-search-unit-key="turn-a:0:user"><div data-content-search-unit-key="turn-a:0:user"><div data-user-message-bubble><div dir="auto">Do not include this prompt.</div></div></div></div>
      <div data-content-search-unit-key="turn-a:2:assistant" data-chatgpt-search-unit-key="turn-a:2:assistant">
        <h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-chatgpt-selection-message-id="answer-a"><div data-markdown-text-style="assistant-message"><p>Answer A only.</p></div></div>
        <div><button aria-label="Copy response">Copy response</button></div>
      </div>
    </div></div>
    <div data-turn-key="turn-b"><div data-content-search-turn-key="turn-b">
      <div data-chatgpt-search-unit-key="turn-b:0:user"><div data-user-message-bubble>Second prompt.</div></div>
      <div data-content-search-unit-key="turn-b:2:assistant" data-chatgpt-search-unit-key="turn-b:2:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-markdown-text-style="assistant-message"><p>Answer B only.</p></div></div>
    </div></div>
  </div></div></main>`);
  assert.equal(page.document.querySelectorAll('article, [data-message-role], [data-message-author-role], [data-turn], .markdown, .prose').length, 0);
  page.advance(6000);
  assert.equal(page.buttons().length, 2);
  [...page.buttons()].forEach((button, index) => {
    assert.ok(button.parentElement.getAttribute('data-content-search-unit-key').endsWith(':assistant'));
    button.shadowRoot.querySelector('button').click();
    const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
    assert.equal(markdown, index === 0 ? 'Answer A only.' : 'Answer B only.');
  });
});

test('new-layout source buttons retain readable citation links while action rows are excluded', t => {
  const page = createPage(t, `<main><ol data-conversation-transcript><li data-message-role="assistant"><h4 data-message-attribution>ChatGPT said:</h4>
    <div data-assistant-markdown><p>Evidence from <button data-assistant-sources-payload='[{"title":"Source paper","url":"https://example.com/paper"}]'><span>Source</span></button>.</p></div>
    <div data-message-actions><button>Share response</button><span>Like</span></div></li></ol></main>`);
  page.advance(6000);
  page.buttons()[0].shadowRoot.querySelector('button').click();
  const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
  assert.match(markdown, /\[Source paper\]\(https:\/\/example.com\/paper\)/);
  assert.ok(markdown.startsWith('Evidence from '), 'the transcript list item must not become a Markdown bullet');
  assert.doesNotMatch(markdown, /Share response|ChatGPT said|Like/);
});

test('latest-reply conversion uses the same new-layout cleanup as its per-message button', t => {
  const page = createPage(t, `<main><div data-turn-key="a-turn">
    <div data-content-search-unit-key="a:0:user"><div data-user-message-bubble>Private user question</div></div>
    <div data-content-search-unit-key="a:1:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4>
      <div data-markdown-text-style="assistant-message"><p>The actual answer.</p></div>
      <div data-message-actions><button>Copy response</button></div>
    </div>
  </div></main>`);
  page.advance(6000);
  const status = page.window.ChatSavorBridge.handle('LATEST').status;
  assert.equal(status.responseCount, 1);
  assert.equal(status.buttonCount, 1);
  assert.equal(status.counts.keyedAssistantUnits, 1);
  assert.equal(status.counts.assistantMarkdownBodies, 1);
  const markdown = page.document.querySelector('.ai-saver-modal-host').shadowRoot.querySelector('.raw-md').textContent;
  assert.equal(markdown.trim(), 'The actual answer.');
});
