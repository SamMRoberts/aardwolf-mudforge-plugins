// Deliberately small synthetic HTML host. No MUD, native widget, storage or
// command execution. Records outbound messages; tests supply accepted replies.
export function installBridge() {
  const listeners = new Map(), receivers = [], messages = [], menus = [];
  function bindings(values) {
    for (const node of document.querySelectorAll('[data-mud-bind]')) {
      const key = node.getAttribute('data-mud-bind');
      if (Object.hasOwn(values, key)) node.textContent = String(values[key]);
    }
    for (const [attribute, apply] of [
      ['data-mud-bind-style', (node, key, value) => node.style.setProperty(key, value)],
      ['data-mud-bind-attr', (node, key, value) => {
        node.setAttribute(key, value);
        if (key === 'aria-disabled' && 'disabled' in node) node.disabled = value === 'true';
      }],
    ]) for (const node of document.querySelectorAll(`[${attribute}]`)) {
      for (const pair of node.getAttribute(attribute).split(';')) {
        const [key, binding] = pair.split(':');
        if (Object.hasOwn(values, binding)) apply(node, key, String(values[binding]));
      }
    }
  }
  const send = (event, data = {}) => {
    const message = { event, data: structuredClone(data) };
    messages.push(message);
    window.dispatchEvent(new CustomEvent('smoke-send', { detail: message }));
    return true;
  };
  window.smoke = {
    messages, menus, bindings,
    property(name, value) {
      for (const listener of listeners.get(name) || []) listener(typeof value === 'string' ? value : JSON.stringify(value));
    },
    receive(value) { for (const receiver of receivers) receiver(value); },
  };
  window.mudforge = {
    send,
    onProperty(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    onMessage(callback) { receivers.push(callback); },
    showMenu(items, x, y) { menus.push({ items, x, y }); },
  };
  document.addEventListener('click', event => {
    const control = event.target.closest('[data-mud-action]');
    if (control && !control.disabled) send('action', { action: control.dataset.mudAction });
  });
  document.addEventListener('submit', event => {
    // Inventory and Spells implement their own form messages in the document.
    if (event.defaultPrevented) return;
    event.preventDefault();
    send('submit', { formData: Object.fromEntries(new FormData(event.target)) });
  });
}
