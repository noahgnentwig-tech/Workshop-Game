// A quieter view for players who want the controls and action to fill the screen.
for (const toggle of document.querySelectorAll('.focus-toggle')) {
  toggle.addEventListener('click', () => {
    const enabled = document.body.classList.toggle('focus-view');
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Exit focus view' : 'Focus view';
    const game = document.querySelector('#arena-game:not([hidden]), .game-board');
    if (game) game.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
}
const activeGame = document.querySelector('#arena-game, #active-screen');
if (activeGame) new MutationObserver(() => {
  if (!activeGame.hidden) return;
  document.body.classList.remove('focus-view');
  for (const toggle of document.querySelectorAll('.focus-toggle')) {
    toggle.setAttribute('aria-pressed', 'false'); toggle.textContent = 'Focus view';
  }
}).observe(activeGame, { attributes: true, attributeFilter: ['hidden'] });
