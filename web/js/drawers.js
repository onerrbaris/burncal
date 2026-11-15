import { t, displayText } from './i18n.js?v=20261115-tri-marks';
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
    else button.innerHTML = closed ? `<span aria-hidden="true">‹</span><b>${t('drawer.openCalendar')}</b>` : '›';
    button.classList.toggle('labeled', direction === 'right' && closed);
    button.setAttribute('aria-expanded', String(!closed));
    const title = id === 'panel' && closed ? t('drawer.openCalendar') : t(closed ? 'drawer.open' : 'drawer.close', [displayText(label)]);
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

// Her yeni seçimde (il, bölge, ülke, çizilen alan) özet açılır, grafik paneli kapalı başlar ve
// "Yangın takvimini aç" ile açılır. Yıl, ay ya da sekme değişimi panelin durumuna dokunmaz.
let selected = '';
const panel = document.getElementById('panel');
new MutationObserver(() => {
  const name = panel.hidden ? '' : panel.dataset.sel || '';
  if (name && name !== selected) for (const d of drawers) if (d.id !== 'rank') d.set(d.id === 'panel');
  selected = name;
}).observe(panel, { attributes: true, attributeFilter: ['hidden', 'data-sel'], childList: true, subtree: true });

window.addEventListener('burncal:language', () => {
  for (const { id, set } of drawers) set(document.getElementById(id).classList.contains('drawer-closed'));
});
