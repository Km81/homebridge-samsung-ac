// Version 1.5.6
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

    // 캐시 & 폴링 설정
    this.cacheDuration = config.cacheDuration || 60000;
    this.deviceState = { Operation:{}, Temperatures:[{}], Mode:{}, Wind:{} };
    this.lastStateUpdate = 0;
    this.isFetching = false;

    // 마지막으로 UI에 푸시한 값 저장소
    this.lastPushed = {
      power: null,
      curTemp: null,
      tgtTemp: null,
      mode: null,
      swing: null,
      autoClean: null
    };

    this.log.info(`[${this.name}] init v1.5.6`);

    if (!this.ip||!this.token||!this.patchCert) {
      this.log.error(`[${this.name}] Missing config`);
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

    // 초기 UI 푸시(값 없으면 그대로 넘어감)
    this.pushStateToHomeKit();

    this.getAndUpdateStateInBackground('Init');
    setInterval(() => this.getAndUpdateStateInBackground('Poll'), 30000);
  }

  _request(method, path, data=null) {
    return new Promise((res, rej) => {
      const opts = {
        hostname:this.ip, port:8888, path, method,
        headers:{ Authorization:`Bearer ${this.token}` },
        agent:this.httpsAgent, timeout:5000
      };
      if (data) {
        const body = JSON.stringify(data);
        opts.headers['Content-Type']='application/json';
        opts.headers['Content-Length']=Buffer.byteLength(body);
      }
      const req = https.request(opts, r => {
        if (r.statusCode<200||r.statusCode>=300) return rej(new Error(r.statusCode));
        let buf=[];
        r.on('data',c=>buf.push(c));
        r.on('end',()=>{
          try{ res(JSON.parse(Buffer.concat(buf))) }
          catch(e){ rej(e) }
        });
      });
      req.on('error',rej);
      req.on('timeout',()=>{ req.destroy(); rej(new Error('timeout')) });
      if (data) req.write(JSON.stringify(data));
      req.end();
    });
  }

  async getAndUpdateStateInBackground(caller) {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      const r = await this._request('GET','/devices');
      const d = r.Devices?.[this.deviceIndex];
      if (d) {
        this.deviceState = d;
        this.lastStateUpdate = Date.now();
        this.pushStateToHomeKit();
      }
    } catch(e) {
      this.log.error(`[${this.name}] fetch fail: ${e.message}`);
    } finally {
      this.isFetching = false;
    }
  }

  pushStateToHomeKit() {
    const s = this.deviceState;
    const { Active, CurrentTemperature, CoolingThresholdTemperature, CurrentHeaterCoolerState, SwingMode, LockPhysicalControls } = Characteristic;

    // 계산
    const power = s.Operation.power==='On';
    const curTemp = s.Temperatures[0]?.current;
    const tgtTemp = s.Temperatures[0]?.desired;
    const modeVal = power && ['Cool','CoolClean','Dry','DryClean','Auto','Wind'].includes(s.Mode.modes[0])
                   ? CurrentHeaterCoolerState.COOLING 
                   : CurrentHeaterCoolerState.IDLE;
    const swing = this.swingModeType==='wind'
                ? s.Wind.direction==='Up_And_Low'
                : s.Mode.options.includes('Comode_Nano');
    const autoClean = s.Mode.options.includes('Autoclean_On');

    // 비교 후 updateCharacteristic
    if (this.lastPushed.power !== power) {
      this.aircoSamsung.updateCharacteristic(Active, power);
      this.lastPushed.power = power;
    }
    if (this.lastPushed.curTemp !== curTemp) {
      this.aircoSamsung.updateCharacteristic(CurrentTemperature, curTemp);
      this.lastPushed.curTemp = curTemp;
    }
    if (this.lastPushed.tgtTemp !== tgtTemp) {
      this.aircoSamsung.updateCharacteristic(CoolingThresholdTemperature, tgtTemp);
      this.lastPushed.tgtTemp = tgtTemp;
    }
    if (this.lastPushed.mode !== modeVal) {
      this.aircoSamsung.updateCharacteristic(CurrentHeaterCoolerState, modeVal);
      this.lastPushed.mode = modeVal;
    }
    if (this.lastPushed.swing !== swing) {
      this.aircoSamsung.updateCharacteristic(SwingMode, swing);
      this.lastPushed.swing = swing;
    }
    if (this.lastPushed.autoClean !== autoClean) {
      this.aircoSamsung.updateCharacteristic(LockPhysicalControls, autoClean);
      this.lastPushed.autoClean = autoClean;
    }
  }

  handleGet(cb, caller, fn) {
    const v = fn(this.deviceState);
    cb(null, v);
  }

  async sendCommand(ep, data) {
    await this._request('PUT', `/devices/${this.setDeviceIndex}${ep}`, data);
    // 강제 갱신
    this.lastStateUpdate = 0;
    setTimeout(()=>this.getAndUpdateStateInBackground('CmdUpdate'),1500);
  }

  identify(cb){ cb() }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    const C = Characteristic;

    this.aircoSamsung.getCharacteristic(C.Active)
      .on('get', cb=>this.handleGet(cb,'Power', s=>s.Operation.power==='On'))
      .on('set', (v,cb)=>{ cb(null); this.sendCommand('', {Operation:{power:v?'On':'Off'}}); });

    this.aircoSamsung.getCharacteristic(C.CurrentHeaterCoolerState)
      .on('get', cb=>this.handleGet(cb,'State', s=>{
        return s.Operation.power==='On' && ['Cool','CoolClean','Dry','DryClean','Auto','Wind'].includes(s.Mode.modes[0])
          ? C.CurrentHeaterCoolerState.COOLING
          : C.CurrentHeaterCoolerState.IDLE;
      }));

    this.aircoSamsung.getCharacteristic(C.TargetHeaterCoolerState)
      .setProps({validValues:[C.TargetHeaterCoolerState.COOL]})
      .on('get', cb=>cb(null,C.TargetHeaterCoolerState.COOL))
      .on('set', (v,cb)=>{ cb(null); if(v===C.TargetHeaterCoolerState.COOL) this.sendCommand('/mode',{modes:['DryClean']}); });

    this.aircoSamsung.getCharacteristic(C.CurrentTemperature)
      .on('get', cb=>this.handleGet(cb,'CurTemp', s=>s.Temperatures[0]?.current));

    this.aircoSamsung.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps({minValue:18,maxValue:30,minStep:1})
      .on('get', cb=>this.handleGet(cb,'TgtTemp', s=>s.Temperatures[0]?.desired))
      .on('set', (v,cb)=>{ cb(null); this.sendCommand('/temperatures/0',{desired:v}); });

    this.aircoSamsung.getCharacteristic(C.SwingMode)
      .on('get', cb=>this.handleGet(cb,'Swing', s=>{
        return this.swingModeType==='wind'
          ? s.Wind.direction==='Up_And_Low'
          : s.Mode.options.includes('Comode_Nano');
      }))
      .on('set', (v,cb)=>{ cb(null);
        const cmd = this.swingModeType==='wind'
          ? {direction:v?'Up_And_Low':'Fix'}
          : {options:[v?'Comode_Nano':'Comode_Off']};
        this.sendCommand(this.swingModeType==='wind'?'/wind':'/mode',cmd);
      });

    this.aircoSamsung.getCharacteristic(C.LockPhysicalControls)
      .on('get', cb=>this.handleGet(cb,'AutoClean', s=>s.Mode.options.includes('Autoclean_On')))
      .on('set', (v,cb)=>{ cb(null); this.sendCommand('/mode',{options:[v?'Autoclean_On':'Autoclean_Off']}); });

    return [this.informationService, this.aircoSamsung];
  }
}
