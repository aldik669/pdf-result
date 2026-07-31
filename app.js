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

  /** Поля, которые заполняются из CRM: на время загрузки очищаем, чтобы не мигало чужое имя. */
  const LOADED_KEYS = ['name', 'age', 'date'];

  function clear(keys) {
    keys.forEach((key) => {
      document.querySelectorAll(`[data-amo="${key}"]`).forEach((el) => {
        el.textContent = '';
      });
    });
  }

  /** «данияла сериковa» → «Данияла Сериковa»: имя всегда с большой буквы. */
  function capitalize(value) {
    return String(value || '').replace(/(^|[\s\-–—])([a-zа-яё])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }

  function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  }

  async function load() {
    const id = getLeadId();
    const params = new URLSearchParams(location.search);
    // Ручное переопределение: /41335541?topic=Создание игры на Scratch&mentor=Айгерим
    const override = (key) => (params.get(key) || '').trim();

    if (!id) {
      ['name', 'age', 'topic', 'mentor', 'date'].forEach((k) => fill(k, override(k)));
      return;
    }

    // Пока идёт запрос — поля пустые, а не с демо-данными из разметки.
    clear(LOADED_KEYS);
    document.body.classList.add('is-loading');

    try {
      const res = await fetch(`/api/lead?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

      // Приоритет: параметр ссылки → данные amoCRM → значение в разметке.
      fill('name', capitalize(override('name') || data.name));
      fill('age', override('age') || data.age);
      fill('topic', override('topic') || data.topic);
      fill('mentor', override('mentor') || data.mentor);
      // Даты в сделке может не быть — тогда ставим сегодняшнюю.
      fill('date', override('date') || data.date || today());

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
