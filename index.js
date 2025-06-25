// Version 1.5.8
'use strict';

const https = require('https');
const fs = require('fs');

let Service, Characteristic, Accessory;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;
  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

class SamsungAirco {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;
    this.patchCert = config.patchCert;
    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';

    // 안전한 기본 상태
    this.deviceState = {
      Operation: { power: 'Off' },
      Temperatures: [{ current: 25, desired: 25 }],
      Mode:      { modes: ['Cool'], options: [] },
      Wind:      { direction: 'Fix' }
    };
    this.isFetching = false;

    // 마지막으로 HomeKit에 푸시한 값 기록
    this.lastPushed = {
      power: null,
      curTemp: null,
      tgtTemp: null,
      mode: null,
      swing: null,
      autoClean: null
    };

    this.log.info(`[${this.name}] init v1.5.8`);

    if (!this.ip || !this.token || !this.patchCert) {
      this.log.error(`[${this.name}] Missing required config (ip, token, patchCert).`);
      return;
    }

    this.httpsAgent = new https.Agent({
      keepAlive: true,
      cert: fs.readFileSync(this.patchCert),
      key:  fs.readFileSync(this.patchCert),
      rejectUnauthorized: false,
      ciphers: 'DEFAULT@SECLEVEL=1',
      secureProtocol: 'TLSv1_method'
    });

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'Air Conditioner');

    // 초기 UI 푸시 (기본값)
    this.pushStateToHomeKit();

    // 초기 상태 로드 + 30초 폴링
    this.getAndUpdateStateInBackground('Init');
    setInterval(() => this.getAndUpdateStateInBackground('Poll'), 30000);
  }

  _request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: this.ip,
        port: 8888,
        path,
        method,
        headers: { Authorization: `Bearer ${this.token}` },
        agent: this.httpsAgent,
        timeout: 5000
      };
      if (data) {
        const body = JSON.stringify(data);
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(body);
      }
      const req = https.request(opts, res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let buf = [];
        res.on('data', chunk => buf.push(chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(buf))); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      if (data) req.write(JSON.stringify(data));
      req.end();
    });
  }

  async getAndUpdateStateInBackground(caller) {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      const res = await this._request('GET', '/devices');
      const device = res.Devices?.[this.deviceIndex];
      if (device) {
        this.deviceState = device;
        this.pushStateToHomeKit();
      }
    } catch (err) {
      this.log.error(`[${this.name}] fetch fail (${caller}): ${err.message}`);
    } finally {
      this.isFetching = false;
    }
  }

  pushStateToHomeKit() {
    const s = this.deviceState;
    const C = Characteristic;

    // 안전하게 배열 검사
    const modes   = Array.isArray(s.Mode?.modes)   ? s.Mode.modes   : [];
    const options = Array.isArray(s.Mode?.options) ? s.Mode.options : [];

    // 계산된 값
    const power     = (s.Operation.power === 'On');
    const curTemp   = s.Temperatures[0]?.current;
    const tgtTemp   = s.Temperatures[0]?.desired;
    const modeVal   = (power && modes.some(m => ['Cool','CoolClean','Dry','DryClean','Auto','Wind'].includes(m)))
                    ? C.CurrentHeaterCoolerState.COOLING
                    : C.CurrentHeaterCoolerState.IDLE;
    const swing     = (this.swingModeType === 'wind')
                    ? (s.Wind.direction === 'Up_And_Low')
                    : options.includes('Comode_Nano');
    const autoClean = options.includes('Autoclean_On');

    // 변경된 항목만 HomeKit에 푸시
    if (this.lastPushed.power     !== power)     { this.aircoSamsung.updateCharacteristic(C.Active,                 power);     this.lastPushed.power     = power; }
    if (this.lastPushed.curTemp   !== curTemp)   { this.aircoSamsung.updateCharacteristic(C.CurrentTemperature,     curTemp);   this.lastPushed.curTemp   = curTemp; }
    if (this.lastPushed.tgtTemp   !== tgtTemp)   { this.aircoSamsung.updateCharacteristic(C.CoolingThresholdTemperature, tgtTemp); this.lastPushed.tgtTemp   = tgtTemp; }
    if (this.lastPushed.mode      !== modeVal)   { this.aircoSamsung.updateCharacteristic(C.CurrentHeaterCoolerState, modeVal); this.lastPushed.mode      = modeVal; }
    if (this.lastPushed.swing     !== swing)     { this.aircoSamsung.updateCharacteristic(C.SwingMode,              swing);     this.lastPushed.swing     = swing; }
    if (this.lastPushed.autoClean !== autoClean) { this.aircoSamsung.updateCharacteristic(C.LockPhysicalControls,  autoClean); this.lastPushed.autoClean = autoClean; }
  }

  handleGet(callback, caller, extractor) {
    callback(null, extractor(this.deviceState));
  }

  async sendCommand(endpoint, data) {
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    setTimeout(() => this.getAndUpdateStateInBackground('CmdUpdate'), 1500);
  }

  identify(callback) {
    callback();
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    const C = Characteristic;

    this.aircoSamsung.getCharacteristic(C.Active)
      .on('get', cb => this.handleGet(cb, 'Power', s => s.Operation.power === 'On'))
      .on('set', (v, cb) => { cb(null); this.sendCommand('', { Operation: { power: v ? 'On' : 'Off' } }); });

    this.aircoSamsung.getCharacteristic(C.CurrentHeaterCoolerState)
      .on('get', cb => this.handleGet(cb, 'State', s =>
        (s.Operation.power === 'On' && Array.isArray(s.Mode?.modes) && s.Mode.modes.some(m => ['Cool','CoolClean','Dry','DryClean','Auto','Wind'].includes(m)))
          ? C.CurrentHeaterCoolerState.COOLING
          : C.CurrentHeaterCoolerState.IDLE
      ));

    this.aircoSamsung.getCharacteristic(C.TargetHeaterCoolerState)
      .setProps({ validValues: [C.TargetHeaterCoolerState.COOL] })
      .on('get', cb => cb(null, C.TargetHeaterCoolerState.COOL))
      .on('set', (v, cb) => { cb(null); if (v === C.TargetHeaterCoolerState.COOL) this.sendCommand('/mode', { modes: ['DryClean'] }); });

    this.aircoSamsung.getCharacteristic(C.CurrentTemperature)
      .on('get', cb => this.handleGet(cb, 'CurTemp', s => s.Temperatures[0]?.current));

    this.aircoSamsung.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .on('get', cb => this.handleGet(cb, 'TgtTemp', s => s.Temperatures[0]?.desired))
      .on('set', (v, cb) => { cb(null); this.sendCommand('/temperatures/0', { desired: v }); });

    this.aircoSamsung.getCharacteristic(C.SwingMode)
      .on('get', cb => this.handleGet(cb, 'Swing', s =>
        (this.swingModeType === 'wind')
          ? s.Wind.direction === 'Up_And_Low'
          : Array.isArray(s.Mode?.options) && s.Mode.options.includes('Comode_Nano')
      ))
      .on('set', (v, cb) => { cb(null);
        const cmd = (this.swingModeType === 'wind')
          ? { direction: v ? 'Up_And_Low' : 'Fix' }
          : { options: [v ? 'Comode_Nano' : 'Comode_Off'] };
        this.sendCommand(this.swingModeType === 'wind' ? '/wind' : '/mode', cmd);
      });

    this.aircoSamsung.getCharacteristic(C.LockPhysicalControls)
      .on('get', cb => this.handleGet(cb, 'AutoClean', s => Array.isArray(s.Mode?.options) && s.Mode.options.includes('Autoclean_On')))
      .on('set', (v, cb) => { cb(null); this.sendCommand('/mode', { options: [v ? 'Autoclean_On' : 'Autoclean_Off'] }); });

    return [ this.informationService, this.aircoSamsung ];
  }
}
