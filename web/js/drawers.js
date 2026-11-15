// Kenar panelleri: seçim ve içerik korunur, yalnızca panel haritanın dışına kayar.
const drawers = [];
function drawer(id, label, direction, collapsed = false) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const button = id === 'rank' ? document.getElementById('rankToggle') : document.createElement('button');
  let content = document.getElementById(`${id}Body`);
  if (id === 'rank') {
    content = document.createElement('div');
    content.id = 'rankBody';
    button.remove();
    content.append(...panel.childNodes);
    panel.append(content);
  }
  button.type = 'button';
  button.className = 'drawer-toggle';
  button.setAttribute('aria-controls', content.id);
  panel.classList.add('edge-drawer', `drawer-${direction}`);
  panel.append(button);
  const set = (closed) => {
    panel.classList.toggle('drawer-closed', closed);
    content.inert = closed;
    if (direction === 'left') button.textContent = closed ? '›' : '‹';
    // Kapalı grafik paneli kenarda etiketli tutamaç olarak durur.
    else button.innerHTML = closed ? '<span aria-hidden="true">‹</span><b>Detaylı inceleme</b>' : '›';
    button.classList.toggle('labeled', direction === 'right' && closed);
    button.setAttribute('aria-expanded', String(!closed));
    const title = `${label} ${closed ? 'aç' : 'gizle'}`;
    button.setAttribute('aria-label', title); button.title = title;
    if (id === 'panel') document.body.classList.toggle('right-drawer-closed', closed);
  };
  button.addEventListener('click', (e) => {
    // Sıralamanın eski artı/eksi dinleyicisiyle çakışmaz.
    e.stopImmediatePropagation();
    set(!panel.classList.contains('drawer-closed'));
  }, true);
  set(collapsed);
  drawers.push({ id, set });
}
drawer('rank', 'En çok tespit listesini', 'left', true);
drawer('side', 'İl özetini', 'left');
drawer('panel', 'Grafikleri', 'right', true);

// Yeni il seçilince iki panel de açılır; yıl/sekme değişimi gizleme tercihini bozmaz.
let selected = '', first = true;
const panel = document.getElementById('panel');
new MutationObserver(() => {
  const name = panel.hidden ? '' : panel.querySelector('h2')?.textContent || '';
  // Açılıştaki ilk seçimde (Türkiye) yalnızca özet açılır; sonraki seçimlerde iki panel de.
  if (name && name !== selected) drawers.filter((d) => d.id !== 'rank' && (!first || d.id === 'side')).forEach((d) => d.set(false));
  if (name) first = false;
  selected = name;
}).observe(panel, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
