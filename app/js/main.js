(function () {
  const csInterface = new CSInterface();
  const logEl = document.getElementById('log');
  const defaultReplayInput = document.getElementById('defaultReplayLen');
  const muteCheckbox = document.getElementById('muteBeforeInsert');
  const buttons = document.querySelectorAll('.sync-btn');
  const OFFSET_RE = /^([+-])?(\d{2}):(\d{2}):(\d{2})$/;

  function ensureHostLoaded() {
    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    if (!extensionPath) {
      appendLog('HOST ERROR: extension path unavailable');
      return;
    }
    const escaped = extensionPath.replace(/\\/g, '\\\\');
    const script = '$.evalFile("' + escaped + '/jsx/host.jsx")';
    csInterface.evalScript(script);
  }

  function appendLog(message) {
    const time = new Date().toISOString();
    logEl.textContent = `[${time}] ${message}\n` + logEl.textContent;
  }

  function parseOffset(value) {
    const trimmed = value.trim();
    const match = OFFSET_RE.exec(trimmed);
    if (!match) {
      return null;
    }
    const sign = match[1] === '-' ? -1 : 1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3], 10);
    const seconds = parseInt(match[4], 10);
    if (minutes >= 60 || seconds >= 60) {
      return null;
    }
    return sign * (hours * 3600 + minutes * 60 + seconds);
  }

  function escapeForScript(str) {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function handleClick(evt) {
    const btn = evt.currentTarget;
    const track = parseInt(btn.dataset.track, 10);
    const startCheckbox = document.querySelector('.start-as-begin[data-track="' + track + '"]');
    const offsetInput = document.querySelector('.offset[data-track="' + track + '"]');

    offsetInput.classList.remove('error');

    const offsetSeconds = parseOffset(offsetInput.value);
    if (offsetSeconds === null) {
      offsetInput.classList.add('error');
      appendLog('Ошибка: некорректный формат сдвига времени для V' + (track + 1));
      return;
    }

    const defaultReplay = parseInt(defaultReplayInput.value, 10);
    if (!defaultReplay || defaultReplay < 1) {
      appendLog('Ошибка: Default Replay length должен быть ≥ 1');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Работа...';

    const payload = {
      trackIndex: track,
      startIsBegin: !!startCheckbox.checked,
      offsetSeconds: offsetSeconds,
      defaultReplayLength: defaultReplay,
      muteBeforeInsert: !!muteCheckbox.checked
    };

    const script = 'garsus_syncTrack("' + escapeForScript(JSON.stringify(payload)) + '")';
    csInterface.evalScript(script, function (result) {
      btn.disabled = false;
      btn.textContent = 'Синхронизировать V' + (track + 1);
      if (result) {
        appendLog(result);
      } else {
        appendLog('Готово без ответа от host.jsx');
      }
    });
  }

  ensureHostLoaded();
  buttons.forEach(function (btn) {
    btn.addEventListener('click', handleClick);
  });
})();
