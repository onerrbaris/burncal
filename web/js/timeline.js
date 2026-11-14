// Renk ölçeği gerektiğinde açılır; yıl kaydırıcısında yalnızca temel kontroller kalır.
const legend = document.getElementById('legend');
const scale = document.createElement('details');
scale.className = 'scale-control';
const toggle = document.createElement('summary');
toggle.textContent = 'Ölçek';
toggle.title = 'Harita renk ölçeğini aç';
scale.append(toggle);
legend.before(scale);
scale.append(legend);
document.addEventListener('pointerdown', (e) => {
  if (!scale.contains(e.target)) scale.open = false;
});
scale.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.stopPropagation(); scale.open = false; toggle.focus(); }
});
