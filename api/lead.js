/**
 * GET /api/lead?id=41335541
 *
 * Достаёт из amoCRM данные по ID сделки и отдаёт их фронтенду:
 *   { id, name, age, topic, mentor, date }
 *
 * Имя и возраст ребёнка лежат в кастомных полях контакта (см. карточку сделки),
 * поэтому читаем сделку вместе со связанными контактами и ищем поля
 * сначала в контакте, потом в самой сделке.
 *
 * Переменные окружения (Vercel → Settings → Environment Variables):
 *   AMO_BASE_URL      — https://kursorschool.amocrm.ru
 *   AMO_ACCESS_TOKEN  — долгосрочный токен приватной интеграции amoCRM
 *   AMO_FIELD_NAME_ID — (необязательно) ID поля «Имя/Имена ребенка»
 *   AMO_FIELD_AGE_ID  — (необязательно) ID поля «Возраст ребенка»
 *   AMO_FIELD_TOPIC_ID, AMO_FIELD_MENTOR_ID, AMO_FIELD_DATE_ID — (необязательно)
 * Если ID полей не заданы, поля ищутся по названию.
 */

const FIELD_MATCHERS = {
  name:   [/им[ея].*реб/i, /имена\s*детей/i, /^имя$/i],
  age:    [/возраст/i],
  topic:  [/тема/i],
  mentor: [/наставник/i, /преподавател/i, /учител/i],
  date:   [/дата.*мк/i, /дата.*мастер/i, /^дата$/i],
};

const ENV_FIELD_IDS = {
  name:   'AMO_FIELD_NAME_ID',
  age:    'AMO_FIELD_AGE_ID',
  topic:  'AMO_FIELD_TOPIC_ID',
  mentor: 'AMO_FIELD_MENTOR_ID',
  date:   'AMO_FIELD_DATE_ID',
};

/** Приводит значение кастомного поля amoCRM к строке. */
function readValue(field) {
  const values = field && field.values;
  if (!Array.isArray(values) || values.length === 0) return '';
  return values
    .map((v) => {
      if (v == null) return '';
      if (typeof v.value === 'object' && v.value !== null) return v.value.name || '';
      // date / date_time / birthday приходят unix-таймштампом
      if (/^(date|date_time|birthday)$/.test(field.field_type || '') && !isNaN(Number(v.value))) {
        return new Date(Number(v.value) * 1000).toLocaleDateString('ru-RU');
      }
      return v.value == null ? '' : String(v.value);
    })
    .filter(Boolean)
    .join(', ');
}

/** Ищет значение поля в сущности amoCRM: сначала по ID из env, потом по названию. */
function pickField(entity, key) {
  const fields = (entity && entity.custom_fields_values) || [];
  if (!fields.length) return '';

  const envId = process.env[ENV_FIELD_IDS[key]];
  if (envId) {
    const byId = fields.find((f) => String(f.field_id) === String(envId));
    if (byId) return readValue(byId);
  }

  for (const re of FIELD_MATCHERS[key]) {
    const byName = fields.find((f) => re.test(f.field_name || ''));
    if (byName) {
      const value = readValue(byName);
      if (value) return value;
    }
  }
  return '';
}

/** Токен принимаем под любым из привычных имён. */
const TOKEN_VARS = ['AMO_ACCESS_TOKEN', 'AMO_LONG_LIVED_TOKEN', 'AMO_TOKEN', 'AMOCRM_TOKEN'];

function getToken() {
  for (const name of TOKEN_VARS) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

/** Базовый адрес: из AMO_BASE_URL, из AMO_SUBDOMAIN или дефолт аккаунта. */
function getBaseUrl() {
  const raw = (process.env.AMO_BASE_URL || '').trim();
  if (raw) return (raw.startsWith('http') ? raw : `https://${raw}`).replace(/\/+$/, '');

  const sub = (process.env.AMO_SUBDOMAIN || '').trim();
  if (sub) return `https://${sub.replace(/\..*$/, '')}.amocrm.ru`;

  return 'https://kursorschool.amocrm.ru';
}

async function amoGet(path) {
  const res = await fetch(getBaseUrl() + path, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`amoCRM ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  // Диагностика окружения: /api/lead?debug=1 — показывает имена, но не значения.
  if (req.query && req.query.debug) {
    const token = getToken();
    return res.status(200).json({
      base_url: getBaseUrl(),
      token_found: Boolean(token),
      token_var: TOKEN_VARS.find((n) => (process.env[n] || '').trim()) || null,
      token_length: token.length,
      amo_vars_visible: Object.keys(process.env).filter((k) => k.startsWith('AMO')).sort(),
      // какой деплой реально обслуживает домен
      vercel_env: process.env.VERCEL_ENV || null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
      env_var_count: Object.keys(process.env).length,
    });
  }

  const id = String((req.query && req.query.id) || '').trim();
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'bad_id', message: 'Укажите числовой ID сделки: /api/lead?id=41335541' });
  }

  if (!getToken()) {
    return res.status(500).json({
      error: 'not_configured',
      message:
        `Токен amoCRM не найден. Задайте в Vercel одну из переменных: ${TOKEN_VARS.join(', ')}. ` +
        `Сейчас видны только: ${Object.keys(process.env).filter((k) => k.startsWith('AMO')).join(', ') || '— ни одной —'}. ` +
        'После добавления переменных нужен Redeploy.',
    });
  }

  try {
    const lead = await amoGet(`/api/v4/leads/${id}?with=contacts`);
    if (!lead) return res.status(404).json({ error: 'lead_not_found', message: `Сделка ${id} не найдена` });

    // Связанные контакты сделки: главный контакт идёт первым.
    const links = ((lead._embedded && lead._embedded.contacts) || [])
      .slice()
      .sort((a, b) => (b.is_main === true) - (a.is_main === true));

    const contacts = [];
    for (const link of links.slice(0, 3)) {
      try {
        const contact = await amoGet(`/api/v4/contacts/${link.id}`);
        if (contact) contacts.push(contact);
      } catch (_) {
        /* один недоступный контакт не должен ронять ответ */
      }
    }

    // Значение берём из первой сущности, где поле заполнено: контакты → сделка.
    const sources = [...contacts, lead];
    const pick = (key) => {
      for (const src of sources) {
        const value = pickField(src, key);
        if (value) return value;
      }
      return '';
    };

    // В поле может лежать как «10», так и «10 лет» — второе оставляем как есть.
    const ageRaw = pick('age');
    const age = !ageRaw ? '' : /[а-яё]/i.test(ageRaw) ? ageRaw : `${ageRaw} ${plural(ageRaw)}`;

    return res.status(200).json({
      id: Number(id),
      name: pick('name') || (contacts[0] && contacts[0].name) || '',
      age,
      topic: pick('topic'),
      mentor: pick('mentor'),
      date: pick('date'),
      lead_name: lead.name || '',
    });
  } catch (e) {
    if (e.status === 404) {
      return res.status(404).json({ error: 'lead_not_found', message: `Сделка ${id} не найдена` });
    }
    if (e.status === 401 || e.status === 403) {
      return res.status(502).json({ error: 'amo_auth_failed', message: `Токен amoCRM отклонён: ${e.message}` });
    }
    return res.status(e.status || 500).json({ error: 'amo_request_failed', message: e.message });
  }
};

/** «10» → «лет», «21» → «год», «22» → «года». */
function plural(raw) {
  const n = parseInt(String(raw).replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return 'лет';
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return 'лет';
  const last = n % 10;
  if (last === 1) return 'год';
  if (last >= 2 && last <= 4) return 'года';
  return 'лет';
}
