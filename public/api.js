export async function api(url, { method = 'GET', body, keepalive = false } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      keepalive,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error('Cannot reach the local workshop. Check that npm start is still running.', { cause: error });
  }
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(result.error ?? `Request failed (${response.status}).`), { status: response.status });
  }
  return result;
}

export function showMessage(message, error = false) {
  const box = document.querySelector('#page-message');
  box.textContent = message;
  box.dataset.error = String(error);
  box.hidden = false;
}

export function clearMessage() {
  document.querySelector('#page-message').hidden = true;
}

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export const percent = (value) => value == null ? '-' : `${(value * 100).toFixed(1)}%`;
export const seconds = (value) => value == null ? '-' : `${value.toFixed(1)}s`;
