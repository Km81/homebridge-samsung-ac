// Version 1.6.6
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

    // 내부 상태
    this.deviceState = {
      Operation: { power: 'Off' },
      Temperatures: [{ current: 25, desired: 25 }],
      Mode:      { modes: ['Cool'], options: [] },
      Wind:      { direction: 'Fix' }
    };
    this.isFetching = false;

    // “켜짐” 확인 대기 플래그
    this.awaitingOnConfirmation = false;
    this.onCommandTime = 0;

    // 마지막 푸시값 캐시
    this.lastPushed = { power: null, curTemp: null, tgtTemp: null, mode: null, swing: null, autoClean: null };

    this.log.info(`[${this.name}] 플러그인 초기화 중... 버전 1.6.6`);

    if (!this.ip || !this.token || !this.patchCert) {
      this.log.error(`[${this.name}] IP, 토큰, 인증서 경로는 필수입니다.`);
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

    // 초기 푸시
    this.log.info(`[${this.name}] --- 홈킷 UI 초기 푸시 시작 ---`);
    this.pushStateToHomeKit();

    // 폴링 & 심장박동
    this.getAndUpdateStateInBackground('초기화');
    setInterval(() => this.getAndUpdateStateInBackground('정기 갱신'), 30000);
    setInterval(() => this.pushHeartbeat(), 15000);
  }

  // 실제 상태와 “확인 대기” 플래그 결합해 displayPower 계산
  pushStateToHomeKit() {
    this.log.info(`[${this.name}] --- 홈킷 UI 푸시 시작 ---`);
    const s = this.deviceState;
    const C = Characteristic;
    const now = Date.now();

    const actualPower = s.Operation.power === 'On';

    // 서버가 “On” 보고하면 대기 해제
    if (actualPower && this.awaitingOnConfirmation) {
      this.awaitingOnConfirmation = false;
    }

    // 아직 확인 대기 중이면 displayPower = true
    const displayPower = actualPower || this.awaitingOnConfirmation;

    // 나머지 특성 추출
    const curTemp   = s.Temperatures[0]?.current;
    const tgtTemp   = s.Temperatures[0]?.desired;
    const modes     = Array.isArray(s.Mode?.modes)   ? s.Mode.modes   : [];
    const options   = Array.isArray(s.Mode?.options) ? s.Mode.options : [];
    const modeVal   = (displayPower && modes.some(m=>['Cool','CoolClean','Dry','DryClean','Auto','Wind'].includes(m)))
                    ? C.CurrentHeaterCoolerState.COOLING
                    : C.CurrentHeaterCoolerState.IDLE;
    const swing     = (this.swingModeType==='wind')
                    ? (s.Wind.direction==='Up_And_Low')
                    : options.includes('Comode_Nano');
    const autoClean = options.includes('Autoclean_On');

    // 전원
    if (this.lastPushed.power !== displayPower) {
      this.log.info(`[${this.name}] [PUSH] 전원: ${displayPower?'켜짐':'꺼짐'}`);
      this.aircoSamsung.updateCharacteristic(C.Active, displayPower);
      this.lastPushed.power = displayPower;
    }
    // 현재온도
    if (this.lastPushed.curTemp !== curTemp) {
      this.log.info(`[${this.name}] [PUSH] 현재 온도: ${curTemp}°C`);
      this.aircoSamsung.updateCharacteristic(C.CurrentTemperature, curTemp);
      this.lastPushed.curTemp = curTemp;
    }
    // 목표온도
    if (this.lastPushed.tgtTemp !== tgtTemp) {
      this.log.info(`[${this.name}] [PUSH] 목표 온도: ${tgtTemp}°C`);
      this.aircoSamsung.updateCharacteristic(C.CoolingThresholdTemperature, tgtTemp);
      this.lastPushed.tgtTemp = tgtTemp;
    }
    // 운전 상태
    if (this.lastPushed.mode !== modeVal) {
      this.log.info(`[${this.name}] [PUSH] 운전 상태: ${modeVal===C.CurrentHeaterCoolerState.COOLING?'냉방중':'대기'}`);
      this.aircoSamsung.updateCharacteristic(C.CurrentHeaterCoolerState, modeVal);
      this.lastPushed.mode = modeVal;
    }
    // 스윙/무풍
    if (this.lastPushed.swing !== swing) {
      this.log.info(`[${this.name}] [PUSH] ${this.swingModeType==='wind'?'스윙 모드':'무풍 모드'}: ${swing?'켜짐':'꺼짐'}`);
      this.aircoSamsung.updateCharacteristic(C.SwingMode, swing);
      this.lastPushed.swing = swing;
    }
    // 자동청소
    if (this.lastPushed.autoClean !== autoClean) {
      this.log.info(`[${this.name}] [PUSH] 자동 청소: ${autoClean?'켜짐':'꺼짐'}`);
      this.aircoSamsung.updateCharacteristic(C.LockPhysicalControls, autoClean);
      this.lastPushed.autoClean = autoClean;
    }

    this.log.info(`[${this.name}] --- 홈킷 UI 푸시 완료 ---`);
  }

  // 심장박동에서는 pushStateToHomeKit 호출만
  pushHeartbeat() {
    const s = this.deviceState;
    if (!s || !s.Operation) {
      this.log.warn(`[${this.name}] [HEARTBEAT] 상태 미설정, 스킵`);
      return;
    }
    this.log.info(`[${this.name}] [HEARTBEAT] 이벤트 재전송`);
    this.pushStateToHomeKit();
  }

  _request(method, path, data = null) {
    this.log.debug(`[${this.name}] [REQUEST] --> ${method} ${path}`);
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: this.ip, port:8888, path, method,
        headers: { Authorization: `Bearer ${this.token}` },
        agent: this.httpsAgent, timeout:5000
      };
      let payload;
      if (data) {
        payload = JSON.stringify(data);
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = https.request(opts, res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`상태 코드 ${res.statusCode}`);
          this.log.error(`[${this.name}] [RESPONSE ERROR] ${method} ${path}: ${err.message}`);
          return reject(err);
        }
        let buf = [];
        res.on('data', c=>buf.push(c));
        res.on('end', () => {
          const txt = Buffer.concat(buf).toString().trim();
          if (!txt) {
            this.log.debug(`[${this.name}] [RESPONSE] <-- ${method} ${path} (빈 응답)`);
            return resolve({});
          }
          try {
            const json = JSON.parse(txt);
            this.log.debug(`[${this.name}] [RESPONSE] <-- ${method} ${path} 성공`);
            resolve(json);
          } catch (e) {
            this.log.error(`[${this.name}] [PARSE ERROR] ${method} ${path}: ${e.message}`);
            reject(e);
          }
        });
      });
      req.on('error', e => { this.log.error(`[${this.name}] [REQUEST ERROR] ${method} ${path}: ${e.message}`); reject(e); });
      req.on('timeout', () => { this.log.error(`[${this.name}] [요청 시간 초과] ${method} ${path}`); req.destroy(); reject(new Error('요청 시간 초과')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async getAndUpdateStateInBackground(caller) {
    if (this.isFetching) {
      this.log.debug(`[${this.name}] '${caller}' 이미 업데이트 중`);
      return;
    }
    this.log.info(`[${this.name}] '${caller}' 요청: 기기 상태 조회 중...`);
    this.isFetching = true;
    try {
      const res = await this._request('GET','/devices');
      const device = res.Devices?.[this.deviceIndex];
      if (device) {
        this.deviceState = device;
        this.log.info(`[${this.name}] '${caller}' 성공, UI 푸시`);
        this.pushStateToHomeKit();
      } else {
        this.log.warn(`[${this.name}] '${caller}' 기기 인덱스 ${this.deviceIndex} 없음`);
      }
    } catch (e) {
      this.log.error(`[${this.name}] '${caller}' 실패: ${e.message}`);
    } finally {
      this.isFetching = false;
    }
  }

  handleGet(cb, caller, extractor) {
    const val = extractor(this.deviceState);
    this.log.info(`[${this.name}] [GET] '${caller}' 캐시값(${val}) 응답`);
    cb(null, val);
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    const C = Characteristic;

    // Active
    this.aircoSamsung.getCharacteristic(C.Active)
      .on('get', cb => this.handleGet(cb,'전원', s=>s.Operation.power==='On'))
      .on('set', (v, cb) => {
        this.log.info(`[${this.name}] [SET] 전원 -> ${v?'켜짐':'꺼짐'}`);
        // 바로 “확인 대기” 모드로
        if (v) {
          this.awaitingOnConfirmation = true;
          this.onCommandTime = Date.now();
        }
        // 즉시 UI 반영
        this.deviceState.Operation.power = v?'On':'Off';
        this.aircoSamsung.updateCharacteristic(C.Active, v);
        this.lastPushed.power = v;
        cb(null);
        this.sendCommand('',{Operation:{power:v?'On':'Off'}});
      });

    // CurrentHeaterCoolerState
    this.aircoSamsung.getCharacteristic(C.CurrentHeaterCoolerState)
      .on('get', cb => this.handleGet(cb,'운전 상태', s=>{
        const ms = Array.isArray(s.Mode?.modes)? s.Mode.modes:[];
        return (s.Operation.power==='On' && ms.some(m=>['Cool','Dry','Auto','Wind'].includes(m)))
          ? C.CurrentHeaterCoolerState.COOLING
          : C.CurrentHeaterCoolerState.IDLE;
      }));

    // TargetHeaterCoolerState
    this.aircoSamsung.getCharacteristic(C.TargetHeaterCoolerState)
      .setProps({validValues:[C.TargetHeaterCoolerState.COOL]})
      .on('get', cb=>{ this.log.info(`[${this.name}] [GET] 목표 모드 -> 냉방`); cb(null,C.TargetHeaterCoolerState.COOL); })
      .on('set', (v,cb)=>{
        this.log.info(`[${this.name}] [SET] 목표 모드 -> ${v}`);
        cb(null);
        if (Date.now()-this.onCommandTime < 5000) {
          this.log.info(`[${this.name}] [SET] 전원 직후 모드 변경 건너뜀`);
          return;
        }
        this.sendCommand('/mode',{modes:['DryClean']});
      });

    // CurrentTemperature
    this.aircoSamsung.getCharacteristic(C.CurrentTemperature)
      .on('get', cb=>this.handleGet(cb,'현재 온도', s=>s.Temperatures[0]?.current));

    // CoolingThresholdTemperature
    this.aircoSamsung.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({minValue:18,maxValue:30,minStep:1})
      .on('get', cb=>this.handleGet(cb,'목표 온도', s=>s.Temperatures[0]?.desired))
      .on('set', (v,cb)=>{
        this.log.info(`[${this.name}] [SET] 목표 온도 -> ${v}°C`);
        this.deviceState.Temperatures[0].desired = v;
        this.aircoSamsung.updateCharacteristic(C.CoolingThresholdTemperature, v);
        this.lastPushed.tgtTemp = v;
        cb(null);
        this.sendCommand('/temperatures/0',{desired:v});
      });

    // SwingMode
    this.aircoSamsung.getCharacteristic(C.SwingMode)
      .on('get', cb=>this.handleGet(cb,'스윙/무풍', s=>{
        const opts = Array.isArray(s.Mode?.options)? s.Mode.options:[];
        return this.swingModeType==='wind'
          ? s.Wind.direction==='Up_And_Low'
          : opts.includes('Comode_Nano');
      }))
      .on('set', (v,cb)=>{
        this.log.info(`[${this.name}] [SET] 스윙/무풍 -> ${v?'켜짐':'꺼짐'}`);
        if (this.swingModeType==='wind') {
          this.deviceState.Wind.direction = v?'Up_And_Low':'Fix';
        } else {
          this.deviceState.Mode.options = [v?'Comode_Nano':'Comode_Off'];
        }
        this.aircoSamsung.updateCharacteristic(C.SwingMode, v);
        this.lastPushed.swing = v;
        cb(null);
        const ep = this.swingModeType==='wind'?'/wind':'/mode';
        const cmd = this.swingModeType==='wind'
          ? {direction:v?'Up_And_Low':'Fix'}
          : {options:[v?'Comode_Nano':'Comode_Off']};
        this.sendCommand(ep,cmd);
      });

    // LockPhysicalControls
    this.aircoSamsung.getCharacteristic(C.LockPhysicalControls)
      .on('get', cb=>this.handleGet(cb,'자동 청소', s=>{
        const opts = Array.isArray(s.Mode?.options)? s.Mode.options:[];
        return opts.includes('Autoclean_On');
      }))
      .on('set',(v,cb)=>{
        this.log.info(`[${this.name}] [SET] 자동 청소 -> ${v?'켜짐':'꺼짐'}`);
        this.deviceState.Mode.options = [v?'Autoclean_On':'Comode_Off'];
        this.aircoSamsung.updateCharacteristic(C.LockPhysicalControls, v);
        this.lastPushed.autoClean = v;
        cb(null);
        this.sendCommand('/mode',{options:[v?'Autoclean_On':'Comode_Off']});
      });

    return [ this.informationService, this.aircoSamsung ];
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[${this.name}] [SEND] ${endpoint} -> ${JSON.stringify(data)}`);
    try {
      await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
      this.log.info(`[${this.name}] [SEND] 전송 성공: ${endpoint}`);
    } catch (e) {
      this.log.error(`[${this.name}] [SEND] 전송 실패: ${e.message}`);
    }
    setTimeout(() => this.getAndUpdateStateInBackground(`명령 후 업데이트 (${endpoint})`), 1500);
  }

  identify(cb) {
    this.log.info(`[${this.name}] 식별 요청`);
    cb();
  }
}
