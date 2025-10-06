(function () {
  if (typeof window === 'undefined') {
    return;
  }

  var SystemPath = {
    USER_DATA: 'userData',
    COMMON_FILES: 'commonFiles',
    MY_DOCUMENTS: 'myDocuments',
    APPLICATION: 'application',
    EXTENSION: 'extension'
  };

  function CSInterface() {
    this.hostEnvironment = this.getHostEnvironment();
  }

  CSInterface.prototype.getSystemPath = function (pathType) {
    if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.getSystemPath) {
      return __adobe_cep__.getSystemPath(pathType);
    }
    return '';
  };

  CSInterface.prototype.getHostEnvironment = function () {
    if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.getHostEnvironment) {
      try {
        return JSON.parse(__adobe_cep__.getHostEnvironment());
      } catch (err) {
        return {};
      }
    }
    return {};
  };

  CSInterface.prototype.evalScript = function (script, callback) {
    if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.evalScript) {
      __adobe_cep__.evalScript(script, callback || function () {});
    } else {
      console.warn('CEP runtime is unavailable. evalScript skipped.');
      if (callback) {
        callback('');
      }
    }
  };

  CSInterface.prototype.dispatchEvent = function (event) {
    if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.dispatchEvent) {
      __adobe_cep__.dispatchEvent(event);
    }
  };

  CSInterface.prototype.addEventListener = function (name, handler) {
    if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.addEventListener) {
      __adobe_cep__.addEventListener(name, handler);
    }
  };

  CSInterface.prototype.removeEventListener = function (name, handler) {
    if (typeof __adobe_cep__ !== 'undefined' && __adobe_cep__.removeEventListener) {
      __adobe_cep__.removeEventListener(name, handler);
    }
  };

  window.SystemPath = SystemPath;
  window.CSInterface = CSInterface;
})();
