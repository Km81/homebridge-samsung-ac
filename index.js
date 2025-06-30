// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.9 (Final Stable Version)
'use strict';

const https = require('https');
const fs = require('fs');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

const defaultCertificate = `
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDeXvhcsqRFWfQt
Qr2TGW+ePJzrKQVNOZmCGFXrBmOKa2gcZvXqDe71upkCmbXxDZbsqU1nFox6WtKy
za+JE1EaWIjVFV/D0hnnF+CA56851rFjAx7YYVtd9TwJYV1lSfJaQBU/ecUys0SX
lKZJtjIoJ/PyLREE79TjOqTxXMXnDpiAt3oiwApZMweJ5z2QViqtRepkI33GDgYc
LzamIengSG6WZkEUr2roY0il4aVXf3IRVRX+5cJ2L5462kFPKm/UnrXrSsrLwbF9
ltSlNA8FgpHN3d9ZyqB3MB46oGYyxYYU7a+/R3RAx0joNfVPFe8riQXQcoNEgalb
c8f7N4HPAgMBAAECggEABL80QA5UMWLNMpYlI9m8Jz2V//MdONvM6hkI5H57a34F
d+2+vCNWAYrdL1AGsUGgAidPDq9NimMb8lMvtxZhedV//kR5id2XTfaVhUrs06hA
myN66hWR9LyCbpTUgJAGi2Soz3US/5USFsZGknZANdk8fOP3ZAqWmc8rrDdVxivg
Z3qjiqgIZg24XsZmnK/QJejP4FLMqm6YUouH//u9xSKvTwkg89qxvygW9xNBNfi/
LrBHip/k8LnynKRE2odQWt74HcTjbZW4rxXrJ0tqDSIh8bUB23mRjFh1k4aKXnz3
Y/CDsfxvAutVi85/zyxYaIT6daP+PxvywwgjVhYHIQKBgQDyMxmGdi5kk3ePv0lM
lC28gVNhgKfhsXL8xIzcd/UM3eEK4baA+AKI9p6ifZ8g90NUJGuHxCp8/9yOKcmk
tY5toE45nH4fH9Z3j9NtWHMhXJDGWV+DjeiWmshbUqd7/OoIl1vig1npQqX+PXJR
pwDHnjkQbkyum4k8/IruHx813wKBgQDrCqK0rBkMaarr5eyOJ9BxhCej8i5kCzm7
XSaNgXtpBIQ4Y4r412M2JWaSLnDxlAc0iUhNGnIn4zkEP2HzX5JU4Yto9YAlRZnu
NQSvuVgyLiBCbS7WrRAlsNpTeCU3m+c5QNXBzBlHCiTdw3WS4bINOftsB3xnlJ+D
y/0YZozSEQKBgQCgWV5z3Dh40/0bSVyA+7WQENsgOWpsjOwBFyvfJvgxLZC5gJgw
qIIdJZH/KEY7MBj+UyJx/1jV6xudb2MVzjHeuHwxvj7t4kk+XRVwVlfa5YrgFvma
glBTrWQquf0ypE5Zo8PsomPbgAmf2hSepH9qqYFENJJGI6lnnBdq8WXbZwKBgQCR
p3ye5At9wrnWCB0pFwk4X4JFOd5/xukW8CnlBTmaId9iJmXHwYpM0q6Wpkr9mhNA
/lYc2eemSkxaEoE71Z0UFtVSzNiFwHUcxiRKVVyPdEAvigO9q2/XO5qAoXLG3ElV
FJWizD1Z5bJk7yycQlsZkTX6g0UX12VmwnHsvhhEUQKBgF0AVToAk+/OPxlA3N4A
Xn624Ktxzy/58NSLUfQ57AtL2zivoJzfmhUwgYkPsp+63Wklpcq7X7Q2NB7WscC4
rICqHxNow/KSzwuR6L3u/kewvlsrgTIM2Pp//+QdTK9GGU3HHAZKaNiB8m20k1Bs
NTANFxBk7alY0G7ZUhuzWkg6
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIDmzCCAoOgAwIBAgIBCTANBgkqhkiG9w0BAQUFADBIMQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEbMBkGA1UEAwwSUmVtb3RlQWNj
ZXNzQ0EoQ0UpMCIYDzE5NjAwMTAxMDAwMDAwWhgPMjA2MDAxMDEwMDAwMDBaMGEx
CzAJBgNVBAYTAktSMRwwGgYDVQQKExNTYW1zdW5nIEVsZWN0cm9uaWNzMRAwDgYD
VQQDFAdBQzE0S19NMSIwIAYJKoZIhvcNAQkBFhNBQzE0S19NQHNhbXN1bmcuY29t
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3l74XLKkRVn0LUK9kxlv
njyc6ykFTTmZghhV6wZjimtoHGb16g3u9bqZApm18Q2W7KlNZxaMelrSss2viRNR
GliI1RVfw9IZ5xfggOevOdaxYwMe2GFbXfU8CWFdZUnyWkAVP3nFMrNEl5SmSbYy
KCfz8i0RBO/U4zqk8VzF5w6YgLd6IsAKWTMHiec9kFYqrUXqZCN9xg4GHC82piHp
4EhulmZBFK9q6GNIpeGlV39yEVUV/uXCdi+eOtpBTypv1J6160rKy8GxfZbUpTQP
BYKRzd3fWcqgdzAeOqBmMsWGFO2vv0d0QMdI6DX1TxXvK4kF0HKDRIGpW3PH+zeB
zwIDAQABo3MwcTAdBgNVHQ4EFgQUXzEjosLzA6xbR1KAqnmAp3BNM6MwHwYDVR0j
BBgwFoAU/12TkC/BOF7xDaZZWJ+DGN6nMxcwDAYDVR0TBAUwAwEB/zAhBgNVHREE
GjAYggtzYW1zdW5nLmNvbYIJbG9jYWxob3N0MA0GCSqGSIb3DQEBBQUAA4IBAQBW
0mStlbdvrHqDJ+KOKVf0C/y9FKTODqo/6/wJNZeZ+8ezPza4nFq70MwQYTpSbZhz
5w8bQP9fwSAoa2Vki8ZwcSd85Vi2tHz9O4C7d7zBA3FU8AL3NoEMFv6OGWGPnTY5
mG/Hn+LxuwQddlysfbRDds1LBY8DBUJNAmIeeWqA5Eg8DW6xJUwHeXUElJpSXHW6
XGvpWgAhXqoIf6TirdCrPY6+IzV/FcuVtBDGi+JoxgrMfMLgLEVjeSY96DJinHgZ
RT0FkA5e06Z+fqHh9Btu+aed+kuGSmya/A5wStOkGeKEbezbbN2gtW07lN6VxX3J
OCgygA+hmnBVnRDA8Jzu
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDUTCCAjmgAwIBAgIBADANBgkqhkiG9w0BAQUFADA6MQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczENMAsGA1UEAwwEQ0VDQTAiGA8x
OTYwMDEwMTAwMDAwMFoYDzIwNjAwMTAxMDAwMDAwWjBIMQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEbMBkGA1UEAwwSUmVtb3RlQWNj
ZXNzQ0EoQ0UpMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtatz9GvV
qbV395Whnad9MC9TEOiXuwnw37QHvQUwOTFgc6AenX5SORfb4UTw+0ApFNba9DlY
Xx/K9E5b5DGasDVGGTn+z+6MPB7GuAjkP+WSRwHMjrHRNqrBOr1YJUw3SIbMkRoT
460k9AD9DQDBORRtGBGwcBw6BvdasA+/L3Q63aJ7pDoj3qxocdcgk/zFq0OrxFDL
PMTL7a+a9DS8G10K73XGgES0RBwwhlXXVuLUprD6RgbeLHFsPpIq5vzzEpAYMCF6
vkZKjDGEW7JVTgUu0E37niN3NQv1gIXlJusDH6RWfFQxENZsdFkT/l+kTuY283Ga
2Ei1HsW3Xpt88QIDAQABo1AwTjAdBgNVHQ4EFgQU/12TkC/BOF7xDaZZWJ+DGN6n
MxcwHwYDVR0jBBgwFoAURwF9jkihypJa2u6zRwKrZwRlACswDAYDVR0TBAUwAwEB
/zANBgkqhkiG9w0BAQUFAAOCAQEAZkjxN4O92e1RTaXx1mpazyT98sJVl46R51s1
CTPq35HVfTiBOAu0C5MR6a9vIIFJScy5h69VN4OwDDbMhe/k3m6EfAutlL7lRrre
OT853HJahxdavzaXJ7tcrI/yDJI0X5GbQ8W74mmDt2/5rXsaB+h+NrToGqf6Hvf/
m7ZhUnCAt0hhLmltxTVYS25s9KoiIH0rXOb9cqUFsmBMEG2pHWC5AiSc0cXJm+kU
3z0B2GS+4IjGdVr3FTPzzTXrpqq/X1cIVKAum5WfsFMS0CRvqTVNVwYg52n69T2B
NPCCEpp9rsIieZ58jsnc506Uc+1Vp+NmBI2A/ecypZxSb6v9gg==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDRTCCAi2gAwIBAgIBBDANBgkqhkiG9w0BAQUFADA8MQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEPMA0GA1UEAwwGUk9PVENBMCIY
DzE5NjAwMTAxMDAwMDAwWhgPMjA2MDAxMDEwMDAwMDBaMDoxCzAJBgNVBAYTAktS
MRwwGgYDVQQKDBNTYW1zdW5nIEVsZWN0cm9uaWNzMQ0wCwYDVQQDDARDRUNBMIIB
IjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtv1WJJ7tTs/aa1ZZRjMPPLeb
n/Ev0Y28CSBj/6P031/veZSg/2z65QZUvPjv8MZnIgNoMpxMGbPPO4Dxj+QJthBk
WydWRPguPyE+w3U4SdayZXWpLZTpKfHco3CklFwEqZtG/wTxHD1oOvtT0e2g5c79
hNQt9lQ4Wwzqa3MvQd0JyeB4syy2zRLo5NjJZl1BVn2oTt4xGCjjtAXtAqqHEbEf
pcvB3hPdIpFe6M8zuN22kROKaQ5i4XP4CyEpbFlgKRcWBGQFX3I5f5TdD3Yw1Ril
OLLL9wFsJ+iWLka9tAIcJKCNOf48p7aXm6COFwmjtCNu4wjQozwi6cycKUgxNQID
AQABo1AwTjAdBgNVHQ4EFgQURwF9jkihypJa2u6zRwKrZwRlACswHwYDVR0jBBgw
FoAU7andrmFFrxYM8+93lrn/Fq47sXMwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0B
AQUFAAOCAQEATexseQBXSfUR7fFTFxq6aAvHWIN+h3QLeN1sq8KCM4fbdkH3lOUP
rKW3w1ag62bnJVNjT4xPtzH/DyrqlzQUPTb7S0PfIXt2mu/VURnrmuXidS2grNwv
eu10gURZaz9N2UZEhY7E80tUZwcjAV+YP8+x3/iRQSrWvcMma/r01eUnwrF4xaE9
EYtJ/jTRre8MpEH/lg06m+rZf9Lk/yhG6at0YnUAIytThqFV4Cj8T8jBX+KG8BCo
VyUsFyrO+D6X98gMdTZnLqC1P1iWuxyrOWZTgsf44f5GXzmLqe5KLPvkDb4MywTa
nXrSOPSkcIgvS6WYw2Rii+e6lfVzqmhAmg==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDRzCCAi+gAwIBAgIBADANBgkqhkiG9w0BAQUFADA8MQswCQYDVQQGEwJLUjEc
MBoGA1UECgwTU2Ftc3VuZyBFbGVjdHJvbmljczEPMA0GA1UEAwwGUk9PVENBMCIY
DzE5NjAwMTAxMDAwMDAwWhgPMjA2MDAxMDEwMDAwMDBaMDwxCzAJBgNVBAYTAktS
MRwwGgYDVQQKDBNTYW1zdW5nIEVsZWN0cm9uaWNzMQ8wDQYDVQQDDAZST09UQ0Ew
ggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCd67g2hzhbIeSBoFfeqbXi
tzbO4dCWeCigVfmwEDhR1SDA0MfHOVlFpvuFr3WyFPvQZ0ccNrsTpBs5YieI/jZi
FYWO0ktbqQorL1CIFqBL9kAF+34BYtpl98PgJ1grLOH5T3GugJA7Irw0plEFmOfs
IydlUIQHl3oqyMIWPa2nIZ/FGi3hAquEPrvzHZB+QO4c+6tV1WLIaCjn88xkYuwz
uGYxaqJpnGdqhjZRIuHb2DEZPlP1VGdTTAttno36CyWqeHrSC8fXCSu55Zk+1rbC
Py/phOJjSyce2qk0IebETAYLCLqU7ABJxUxrolMrP37OB+Kqe4RWovaeMcdcNOOt
AgMBAAGjUDBOMB0GA1UdDgQWBBTtqd2uYUWvFgzz73eWuf8WrjuxczAfBgNVHSME
GDAWgBTtqd2uYUWvFgzz73eWuf8WrjuxczAMBgNVHRMEBTADAQH/MA0GCSqGSIb3
DQEBBQUAA4IBAQBkwK95x8JCAnY0F2bMwG5+7QfY+ci8s8m1ODi3v19HECS6nG9j
SXgwihEtQ3HqvUler+n7aOeAZlgm+BymM2GvuicveYN/nevIvzlpMOn2L6xU19/H
zM2eoDVfS49+i/cwoi/A7fcZmIYggZho2UJR/GvKc79g6EAhT7/i5alBZF0enMsA
9okzakb/aohQE9SzsEHnhVKpGAjvu0/TJK9WwX6mkiIEJY+mzQMWgEeQt6WWIgAb
gSX9NueH80tpZ9KqFnqnOoLxTAa7k0RPBRwyUO9CDhSnlWIEcsD9sqR2M+niOFnT
KBHcLDDiEU3llprD8FRV3unYrl0F0B2GGdRk
-----END CERTIFICATE-----
`;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.9'; // 최종 버전

class SwingModeHandler {
  constructor(type) { this.type = type; }
  getValue(state) {
    if (!state) return false;
    if (this.type === 'wind') return state.Wind?.direction === 'Up_And_Low';
    return state.Mode?.options?.includes('Comode_Nano');
  }
  getCommand(enable) {
    if (this.type === 'wind') {
      const dir = enable ? 'Up_And_Low' : 'Fix';
      return { endpoint: '/wind', data: { direction: dir } };
    }
    const opt = enable ? 'Comode_Nano' : 'Comode_Off';
    return { endpoint: '/mode', data: { options: [opt] } };
  }
}

module.exports = function(homebridge) {
  HAP = homebridge.hap;
  Service = HAP.Service;
  Characteristic = HAP.Characteristic;
  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

class SamsungAirco {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;
    
    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval;
    this.pollingIntervalId = null; 
    this.swingModeHandler = new SwingModeHandler(this.swingModeType);

    if (!this.ip || !this.token) {
      throw new Error(`[${this.name}] 필수 설정(ip, token)이 누락되었습니다.`);
    }
    
    // https.Agent를 사용하기 위한 옵션 객체
    this.httpsAgent = new https.Agent({
      cert: defaultCertificate,
      key: defaultCertificate,
      rejectUnauthorized: false,
      honorCipherOrder: true,
      ciphers: 'DEFAULT@SECLEVEL=0',
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    });

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'B5VNP3EH701769Y')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.startPolling();

    this.api.on('shutdown', () => {
      this.log.info(`[${this.name}] Homebridge가 종료됩니다. 폴링 타이머를 정리합니다.`);
      if (this.pollingIntervalId) {
        clearInterval(this.pollingIntervalId);
      }
    });

    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료 (인증서 내장)`);
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      this.pollingIntervalId = setInterval(() => {
        this.log.debug(`[${this.name}] 주기적인 상태 업데이트 실행...`);
        this.getCachedState(true).catch(e => this.log.error(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

  // --- ▼▼▼ 통신 방식을 표준 https.request로 되돌립니다 ▼▼▼ ---
  async _request(method, path, data = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const options = {
            hostname: this.ip,
            port: API_PORT,
            path,
            method,
            agent: this.httpsAgent, // TLS 호환성 옵션이 적용된 Agent 사용
            timeout: this.timeout,
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Connection': 'close', // Parse Error 방지를 위한 핵심 헤더
            }
          };

          if (data) {
            const postData = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
          }

          const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
            }
            const body = [];
            res.on('data', chunk => body.push(chunk));
            res.on('end', () => {
              try {
                const responseString = Buffer.concat(body).toString();
                // 응답이 비어있는 경우 빈 객체로 처리
                resolve(JSON.parse(responseString || '{}'));
              } catch (e) {
                reject(new Error(`응답 JSON 파싱 오류: ${e.message}`));
              }
            });
          });

          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('요청 시간 초과'));
          });
          
          if (data) {
            req.write(JSON.stringify(data));
          }
          req.end();
        });
      } catch (e) {
        if (attempt === retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${attempt}회 시도): ${e.message}`);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
  }
  // --- ▲▲▲ 여기까지 수정된 부분입니다 ▲▲▲ ---

  async getCachedState(force = false) {
    const now = Date.now();
    if (!force && this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
      this.log.debug(`[${this.name}] 유효한 캐시 사용`);
      return this.deviceState;
    }
    
    this.log.debug(`[${this.name}] 새 상태 요청`);
    const response = await this._request('GET', API_DEVICES_PATH);
    if (!response || !response.Devices || !Array.isArray(response.Devices) || !response.Devices[this.deviceIndex]) {
      throw new Error(`API 응답에서 장치(index: ${this.deviceIndex})를 찾을 수 없습니다.`);
    }
    this.deviceState = response.Devices[this.deviceIndex];
    this.lastStateUpdate = now;
    return this.deviceState;
  }

  async sendCommand(endpoint, data) {
    this.log.debug(`[${this.name}] [COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.log.info(`[${this.name}] [COMMAND] 전송 완료: ${endpoint}`);
    this.deviceState = null;
    await this.getCachedState(true);
  }

  identify(callback) {
    this.log.info(`[${this.name}] Identify 호출됨.`);
    callback();
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);

    this.aircoSamsung.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));
      
    this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this)); 
      
    this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));
      
    return [this.informationService, this.aircoSamsung];
  }

  // --- Characteristic Handlers ---
  
  async getActive() {
    this.log.debug(`[${this.name}] GET Active`);
    try {
      const state = await this.getCachedState();
      const isActive = state.Operation.power === 'On';
      this.log.info(`[${this.name}] > Active: ${isActive ? 'ON' : 'OFF'}`);
      return isActive ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] GET Active 오류:`, e.message);
      throw e;
    }
  }

  async setActive(value) {
    const targetState = value ? '제습(Dry) 모드로 켜기' : '끄기';
    this.log.info(`[${this.name}] SET Active -> ${targetState}`);
    try {
      if (value) {
        await this.sendCommand('/mode', { "modes": ["Dry"] });
      } else {
        await this.sendCommand('', { "Operation": { "power": "Off" } });
      }
      this.log.info(`[${this.name}] SET Active 완료`);
    } catch (e) {
      this.log.error(`[${this.name}] SET Active 오류:`, e.message);
      throw e;
    }
  }

  async getCurrentHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET CurrentState`);
    try {
      const state = await this.getCachedState();
      if (state.Operation.power !== 'On') {
        this.log.info(`[${this.name}] > CurrentState: INACTIVE (꺼짐)`);
        return Characteristic.CurrentHeaterCoolerState.INACTIVE;
      }
      
      const mode = state.Mode.modes[0];
      const isCooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
      if (isCooling) {
          this.log.info(`[${this.name}] > CurrentState: COOLING`);
          return Characteristic.CurrentHeaterCoolerState.COOLING;
      }
      this.log.info(`[${this.name}] > CurrentState: IDLE`);
      return Characteristic.CurrentHeaterCoolerState.IDLE;
    } catch (e) {
      this.log.error(`[${this.name}] GET CurrentState 오류:`, e.message);
      throw e;
    }
  }
  
  async getTargetHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET TargetState`);
    const value = Characteristic.TargetHeaterCoolerState.COOL;
    this.log.info(`[${this.name}] > TargetState: COOL`);
    return value;
  }

  async setTargetHeaterCoolerState(value) {
    this.log.info(`[${this.name}] SET TargetState -> ${value} (무시됨)`);
  }
  
  async getCurrentTemperature() {
    this.log.debug(`[${this.name}] GET CurrentTemperature`);
    try {
      const state = await this.getCachedState();
      const temp = state.Temperatures[0].current;
      this.log.info(`[${this.name}] > CurrentTemperature: ${temp}°C`);
      return temp;
    } catch (e) {
      this.log.error(`[${this.name}] GET CurrentTemp 오류:`, e.message);
      throw e;
    }
  }

  async getTargetTemperature() {
    this.log.debug(`[${this.name}] GET TargetTemperature`);
    try {
      const state = await this.getCachedState();
      const temp = state.Temperatures[0].desired;
      this.log.info(`[${this.name}] > TargetTemperature: ${temp}°C`);
      return temp;
    } catch (e) {
      this.log.error(`[${this.name}] GET TargetTemp 오류:`, e.message);
      throw e;
    }
  }
  
  async setTargetTemperature(value) {
    this.log.info(`[${this.name}] SET TargetTemperature -> ${value}°C`);
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
    } catch (e) {
      this.log.error(`[${this.name}] SET TargetTemp 오류:`, e.message);
      throw e;
    }
  }
  
  async getSwingMode() {
    this.log.debug(`[${this.name}] GET SwingMode`);
    try {
      const state = await this.getCachedState();
      const isEnabled = this.swingModeHandler.getValue(state);
      this.log.info(`[${this.name}] > SwingMode: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
      return isEnabled ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] GET SwingMode 오류:`, e.message);
      throw e;
    }
  }

  async setSwingMode(value) {
    const enabled = value === 1;
    this.log.info(`[${this.name}] SET SwingMode -> ${enabled ? 'ENABLED' : 'DISABLED'}`);
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(enabled);
      await this.sendCommand(endpoint, data);
    } catch (e) {
      this.log.error(`[${this.name}] SET SwingMode 오류:`, e.message);
      throw e;
    }
  }

  async getLockPhysicalControls() {
    this.log.debug(`[${this.name}] GET LockControls`);
    try {
      const state = await this.getCachedState();
      const isLocked = state.Mode.options.includes('Autoclean_On');
      this.log.info(`[${this.name}] > LockControls: ${isLocked ? 'ENABLED' : 'DISABLED'}`);
      return isLocked ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] GET LockControls 오류:`, e.message);
      throw e;
    }
  }

  async setLockPhysicalControls(value) {
    const cmd = value ? 'Autoclean_On' : 'Autoclean_Off';
    this.log.info(`[${this.name}] SET LockControls -> ${cmd}`);
    try {
      await this.sendCommand('/mode', { options: [cmd] });
    } catch (e) {
      this.log.error(`[${this.name}] SET LockControls 오류:`, e.message);
      throw e;
    }
  }
}
