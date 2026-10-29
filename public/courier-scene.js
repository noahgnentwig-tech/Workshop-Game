// Decorative animation only: the server remains responsible for every game rule.
export const CREW = {
  nova: { name: 'Nova', color: '#28bba6', dark: '#137665', accent: '#a9fff0' },
  bolt: { name: 'Bolt', color: '#ffae53', dark: '#b36527', accent: '#fff1aa' },
  pip: { name: 'Pip', color: '#a292ef', dark: '#6658a5', accent: '#ece2ff' }
};

export function crewPortrait(id) {
  const c = CREW[id];
  // All colours and markup come from the fixed crew list above.
  return `<svg viewBox="0 0 100 100" width="80" height="80" xmlns="http://www.w3.org/2000/svg"><ellipse cx="50" cy="90" rx="28" ry="5" fill="#203b4020"/><path d="M30 78v9m40-9v9" stroke="${c.dark}" stroke-width="10" stroke-linecap="round"/><rect x="24" y="43" width="52" height="38" rx="14" fill="${c.color}"/><path d="M19 58v13m62-13v13" stroke="${c.dark}" stroke-width="9" stroke-linecap="round"/><rect x="18" y="15" width="64" height="44" rx="18" fill="${c.color}"/><rect x="26" y="24" width="48" height="25" rx="10" fill="#183c42"/><path d="M38 34v4m24-4v4" stroke="${c.accent}" stroke-width="5" stroke-linecap="round"/><path d="M46 42q4 4 8 0" fill="none" stroke="${c.accent}" stroke-width="2"/><path d="M50 15V8" stroke="${c.dark}" stroke-width="4"/><circle cx="50" cy="7" r="4" fill="${c.accent}"/><rect x="42" y="65" width="16" height="10" rx="3" fill="${c.accent}"/></svg>`;
}

export function createCourierScene(canvas) {
  const ctx = canvas.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const colors = ['#56bda0', '#aa95e8', '#f6b555'];
  let crew = 'nova';
  let round = null;
  let destinations = [];
  let time = 0;
  let last = 0;
  let phase = 'ready';
  let eventAge = 10;
  let event = null;
  let particles = [];
  let raf;
  let sound = false;
  let audio;

  function box(x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  function line(x, y, x2, y2, color, width = 2) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  function text(value, x, y, size = 11, color = '#bfd5d6', align = 'center') {
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
  }
  function symbol(index, x, y, size = 10, color = '#edfafa') {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    if (index === 0) {
      ctx.beginPath(); ctx.ellipse(0, 0, size * .55, size, .65, 0, Math.PI * 2); ctx.fill();
      line(-size * .6, size * .8, size * .45, -size * .65, '#17493d', 1.5);
    } else if (index === 1) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? size * .45 : size;
        if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(1, -size); ctx.lineTo(-size * .65, 2);
      ctx.lineTo(0, 2); ctx.lineTo(-1, size); ctx.lineTo(size * .7, -2);
      ctx.lineTo(0, -2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function parcel(x, y, index = 0, wrapped = false, scale = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    box(-15, -12, 30, 25, 4, wrapped ? '#c2e9cf' : '#e7b880', '#ad8255');
    box(-3, -12, 6, 25, 0, wrapped ? '#549b73' : '#f8dcac');
    box(-10, -7, 20, 15, 3, '#fff7e7');
    symbol(index, 0, 0, 5.5, colors[index] || colors[0]);
    ctx.restore();
  }
  function robot(x, y, id, { walk = false, carry = false, scale = 1, happy = false, hurt = false, index = 0 } = {}) {
    const c = CREW[id];
    const step = walk ? Math.sin(time * 17) : Math.sin(time * 2.3) * .13;
    const bob = motion.matches ? 0 : walk ? Math.abs(step) * 3 : Math.sin(time * 2.3) * 1.6;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.fillStyle = '#081b2440'; ctx.beginPath(); ctx.ellipse(0, 1, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, -bob);
    box(-14, -14 + step * 4, 10, 16, 4, c.dark);
    box(4, -14 - step * 4, 10, 16, 4, c.dark);
    box(-19, -38, 38, 28, 10, c.color);
    box(-27, -32 + step * 2, 9, 22, 4, c.dark);
    box(18, -32 - step * 2, 9, 22, 4, c.dark);
    box(-24, -65, 48, 33, 12, hurt ? '#f58f81' : c.color);
    box(-18, -59, 36, 21, 8, '#18383f');
    const blink = !motion.matches && Math.sin(time * .9) > .994;
    if (happy) {
      ctx.strokeStyle = c.accent; ctx.lineWidth = 2.5;
      for (const eye of [-8, 8]) { ctx.beginPath(); ctx.arc(eye, -49, 4, Math.PI, 0); ctx.stroke(); }
    } else {
      box(-11, -53, 5, blink ? 2 : 7, 2, c.accent);
      box(6, -53, 5, blink ? 2 : 7, 2, c.accent);
    }
    line(-3, -43, 3, -43, c.accent, 1.5);
    line(0, -65, 0, -71, c.dark, 3);
    ctx.beginPath(); ctx.arc(0, -74, 3, 0, Math.PI * 2); ctx.fillStyle = c.accent; ctx.fill();
    if (carry) parcel(0, -21, index, Boolean(round?.wrappedParcels?.includes(round.parcels[round.sorted]?.id)), .85);
    else box(-7, -29, 14, 9, 3, c.accent);
    ctx.restore();
  }

  function draw() {
    if (!ctx) return;
    const width = canvas.clientWidth || 900;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const height = canvas.clientHeight || 250;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(canvas.width / 900, 0, 0, canvas.height / 250, 0, 0);
    ctx.clearRect(0, 0, 900, 250);
    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, '#183c45'); gradient.addColorStop(1, '#102c37');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 900, 250);
    // Quiet architectural details, conveyor, and three visually distinct loading bays.
    for (let x = -100; x < 1000; x += 75) line(x, 250, x + 120, 73, '#23434d', 1);
    for (const y of [94, 125, 166, 218]) line(0, y, 900, y, '#23434d', 1);
    box(25, 18, 180, 55, 9, '#244b54');
    text('DISPATCH / 03', 44, 39, 11, '#c5e4df', 'left');
    for (let i = 0; i < 6; i++) box(44 + i * 25, 50, 17, 4, 2, i < (round?.multiplier || 1) ? '#7aead1' : '#3b6066');
    for (let i = 0; i < 3; i++) {
      const x = 326 + i * 218;
      const flash = event?.index === i && eventAge < .8;
      box(x - 68, 16, 136, 58, 10, '#203f4b', flash && event?.type === 'error' ? '#ff8b7e' : colors[i]);
      box(x - 54, 30, 36, 31, 5, colors[i]); symbol(i, x - 36, 45, 10, '#153a3d');
      text(round?.config?.showDestinationLabels === false ? `BAY ${i + 1}` : (destinations[i]?.name || ['Garden', 'Studio', 'Workshop'][i]).toUpperCase(), x + 20, 43, 10, '#e5f3ed');
      text(`[ ${['J', 'K', 'L'][i]} ]`, x + 20, 59, 10, colors[i]);
      box(x - 53, 78, 106, 9, 3, flash && event.type === 'delivery' ? colors[i] : '#34525b');
    }
    box(20, 170, 860, 52, 14, '#0b242e', '#3b5960');
    ctx.save(); ctx.beginPath(); ctx.rect(30, 178, 840, 34); ctx.clip();
    const offset = motion.matches ? 0 : (time * (phase === 'playing' ? 55 : 18)) % 35;
    for (let x = -35; x < 900; x += 35) {
      line(x + offset, 180, x + offset - 20, 211, '#294650', 6);
    }
    ctx.restore();
    text('INCOMING', 84, 243, 10, '#87afb7');
    text(phase === 'playing' ? 'KEEP THE GOOD STUFF MOVING' : 'YOUR CREW IS READY', 750, 243, 10, '#87afb7');
    const current = round?.parcels?.[round.sorted];
    const index = Math.max(0, destinations.findIndex(d => d.id === current?.destination));
    for (let i = 0; i < 3; i++) {
      const queued = round?.parcels?.[round.sorted + i];
      const pi = queued ? Math.max(0, destinations.findIndex(d => d.id === queued.destination)) : i;
      if (!round || queued) parcel(90 + i * 78, 193, pi, false, .85);
    }
    let x = 450, y = 175, walk = false, carry = Boolean(current);
    if (!motion.matches && event?.type === 'delivery' && eventAge < .9) {
      const path = Math.sin(Math.min(1, eventAge / .9) * Math.PI);
      x += (326 + event.index * 218 - 450) * path;
      y -= path * 58;
      walk = true; carry = eventAge < .45;
    }
    if (!motion.matches && event?.type === 'error' && eventAge < .45) x += Math.sin(eventAge * 65) * 5;
    if (phase === 'completed' && !motion.matches) y -= Math.abs(Math.sin(time * 7)) * 12;
    const others = Object.keys(CREW).filter(id => id !== crew);
    robot(172 + (motion.matches ? 0 : Math.sin(time * .65) * 22), 154, others[0], { scale: .68, walk: phase === 'playing', carry: true, index: 1 });
    robot(820 + (motion.matches ? 0 : Math.sin(time * .8) * 20), 157, others[1], { scale: .68, walk: phase === 'playing', happy: phase === 'completed' });
    robot(x, y, crew, { walk, carry, index: event?.type === 'delivery' && eventAge < .9 ? event.index : index,
      happy: event?.type === 'delivery' && eventAge < 1.2 || phase === 'completed', hurt: event?.type === 'error' && eventAge < .5 });
    text(CREW[crew].name.toUpperCase(), x, y + 18, 10, CREW[crew].accent);
    if (event?.type === 'wrap' && eventAge < 1 && !motion.matches) {
      ctx.strokeStyle = '#b7f6d1'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.ellipse(x, y - 30, 35 + eventAge * 15, 19 + eventAge * 10, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (eventAge < 1.1 && event?.label) {
      const lift = motion.matches ? 0 : eventAge * 20;
      ctx.globalAlpha = Math.max(0, 1 - eventAge / 1.1);
      text(event.label, x, y - 90 - lift, 17, event.type === 'error' ? '#ffad9c' : '#c5ff91'); ctx.globalAlpha = 1;
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      box(p.x, p.y, 5, 5, 1, p.color); ctx.globalAlpha = 1;
    }
  }
  function tone(type) {
    if (!sound) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') void audio.resume().catch(() => {});
      const notes = type === 'error' ? [170, 120] : type === 'wrap' ? [380, 510] : type === 'combo' ? [523, 659, 880] : type === 'completed' ? [523, 659, 784, 1047] : [660, 880];
      notes.forEach((hz, i) => {
        const osc = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * .075;
        osc.type = 'sine'; osc.frequency.value = hz;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.05, at + .008);
        gain.gain.exponentialRampToValueAtTime(.001, at + .12);
        osc.connect(gain); gain.connect(audio.destination); osc.start(at); osc.stop(at + .14);
      });
    } catch { sound = false; }
  }
  function burst(index, count = 14) {
    if (motion.matches) return;
    for (let i = 0; i < count; i++) {
      particles.push({ x: 326 + index * 218, y: 90, vx: (Math.random() - .5) * 140,
        vy: -30 - Math.random() * 90, life: 1, color: colors[i % 3] });
    }
    particles = particles.slice(-90);
  }
  function frame(stamp) {
    const dt = Math.min((stamp - (last || stamp)) / 1000, .05); last = stamp;
    time += dt; eventAge += dt;
    particles = particles.filter(p => p.life > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 170 * dt; p.life -= dt * 1.2; }
    if (!document.hidden) draw();
    if (!motion.matches && !document.hidden) raf = requestAnimationFrame(frame);
    else raf = null;
  }
  function wake() {
    draw();
    if (!raf && !motion.matches && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); }
  }
  document.addEventListener('visibilitychange', wake);
  motion.addEventListener('change', wake);
  new ResizeObserver(wake).observe(canvas);
  wake();
  return {
    select(id) { if (CREW[id]) { crew = id; wake(); } },
    configure(items) { destinations = items; wake(); },
    start() { round = null; phase = 'playing'; event = null; particles = []; wake(); },
    sync(next) { round = next; phase = next.status; wake(); },
    react(type, destination, label, milestone = false) {
      const index = Math.max(0, destinations.findIndex(d => d.id === destination));
      event = { type, index, label }; eventAge = 0;
      if (type === 'delivery') burst(index, milestone ? 32 : 14);
      tone(milestone ? 'combo' : type); wake();
    },
    finish(completed) {
      if (completed) { for (let i = 0; i < 3; i++) burst(i, 24); tone('completed'); }
      wake();
    },
    async toggleSound() {
      if (sound) { sound = false; return false; }
      try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        await audio.resume(); sound = audio.state === 'running';
        if (sound) tone('wrap');
      } catch { sound = false; }
      return sound;
    }
  };
}
