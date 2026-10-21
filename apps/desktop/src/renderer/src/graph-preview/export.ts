import { mount } from 'svelte';
import { setLocale } from '@skaro/ui';
import type { C4Model } from '@skaro/core/c4-view';
import ExportGraphPreview from './ExportGraphPreview.svelte';
import './i18n';

// The HTML contains an actual rendered Skaro shell and accepted C4 data, no backend shim.
const source = document.getElementById('accepted-c4-source');
const target = document.getElementById('graph-export');
if (!source || !target) throw new Error('The exported native shell is missing.');
setLocale('ru');
const preview = mount(ExportGraphPreview, {
  target,
  props: { model: JSON.parse(source.textContent!) as C4Model },
});
const tree = Array.from(document.querySelectorAll<HTMLElement>('.project-nav .item'));
for (const item of tree) {
  const title = item.textContent?.trim();
  if (title !== 'C4' && title !== 'Граф связей') continue;
  item.addEventListener('click', () => {
    tree.forEach((entry) => {
      entry.classList.toggle('active', entry === item);
      if (entry === item) entry.setAttribute('aria-current', 'page');
      else entry.removeAttribute('aria-current');
    });
    if (title === 'C4') preview.openC4();
    else preview.closeC4();
  });
}
