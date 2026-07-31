/**
 * Подстановка данных из amoCRM в лист результатов.
 *
 * ID сделки берётся из ссылки — поддерживаются оба формата:
 *   /?id=41335541      (или ?lead=41335541)
 *   /41335541          (через rewrite в vercel.json)
 *
 * Без ID страница показывает статичный демо-текст, который лежит в разметке.
 */
(function () {
  'use strict';

  function getLeadId() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('id') || params.get('lead') || params.get('lead_id');
    if (fromQuery && /^\d+$/.test(fromQuery.trim())) return fromQuery.trim();

    const fromPath = location.pathname.match(/(\d{4,})/);
    return fromPath ? fromPath[1] : null;
  }

  function fill(key, value) {
    if (!value) return;
    document.querySelectorAll(`[data-amo="${key}"]`).forEach((el) => {
      el.textContent = value;
    });
  }

  async function load() {
    const id = getLeadId();
    if (!id) return;

    document.body.classList.add('is-loading');

    try {
      const res = await fetch(`/api/lead?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

      fill('name', data.name);
      fill('age', data.age);
      fill('topic', data.topic);
      fill('mentor', data.mentor);
      fill('date', data.date);

      if (data.name) document.title = `KURSOR — лист результатов: ${data.name}`;
    } catch (e) {
      console.error('[kursor] не удалось загрузить данные сделки:', e);
      document.body.classList.add('is-error');
    } finally {
      document.body.classList.remove('is-loading');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
