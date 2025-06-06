# Homebridge Samsung AC

다양한 삼성 에어컨 모델을 지원하기 위해 통합되고 최적화된 스마트 홈브리지 플러그인입니다. 구형 API를 사용하는 삼성 에어컨에서 발생하는 각종 SSL/TLS 통신 오류에 대한 해결책이 포함되어 있습니다.

## 주요 특징
- 💨 **통합 모델 지원**: `config.json` 설정만으로 무풍 에어컨과 일반 회전 에어컨 모델을 모두 지원합니다.
- ⚡️ **고성능 및 안정성**: `axios` 대신 Node.js 내장 `https` 모듈을 사용하여 불필요한 라이브러리 의존성을 제거하고 안정적인 통신을 보장합니다.
- 🔒 **강력한 호환성**: `ca md too weak`, `unsupported protocol`, `400 Bad Request` 등 구형 삼성 에어컨 API에서 발생하는 대부분의 통신 오류를 해결하는 로직이 내장되어 있습니다.
- ⚙️ **유연한 설정**: 기기 인덱스, 스윙 모드 타입 등 다양한 옵션을 통해 사용자의 환경에 맞게 플러그인을 설정할 수 있습니다.
- 🌬️ **커스텀 모드 매핑**: 홈 앱의 '자동' 모드를 에어컨의 '송풍(Wind)' 모드로 연결하는 등, 사용자가 원하는 대로 모드를 매핑하여 사용할 수 있습니다.

## 설치
1. Homebridge UI에 접속하여 '플러그인' 탭으로 이동합니다.
2. 검색창에 `homebridge-samsung-ac`를 검색하여 설치합니다.

## 설정 (`config.json`)

Homebridge `config.json` 파일의 `accessories` 배열 안에 아래와 같은 형식의 객체를 추가합니다.

```json
{
  "accessory": "SamsungAC",
  "name": "거실 에어컨",
  "ip": "192.168.1.100",
  "token": "YOUR_AC_TOKEN",
  "patchCert": "/path/to/your/cert.pem",
  "deviceIndex": 1,
  "setDeviceIndex": 0,
  "swingModeType": "comfort",
  "serialNumber": "SA-LIVINGROOM-01"
}
```

### 설정 옵션 상세

| 키 | 설명 | 필수 | 기본값 |
|---|---|:---:|---|
| `accessory` | 플러그인 이름. **"SamsungAC"**로 고정해야 합니다. | O | |
| `name` | 홈 앱에 표시될 액세서리의 이름입니다. | O | |
| `ip` | 에어컨의 고정 IP 주소입니다. | O | |
| `token` | API 인증 토큰입니다. | O | |
| `patchCert`| 인증서 파일(`*.pem`)의 절대 경로입니다. **Docker 사용 시 컨테이너 내부 경로**를 입력해야 합니다. | O | |
| `deviceIndex` | API 응답(`GET /devices`)에서 상태를 **읽어올** 기기의 인덱스입니다. (0부터 시작) | X | `0` |
| `setDeviceIndex` | API로 명령을 **보낼** 때 사용할 기기의 인덱스입니다. | X | `deviceIndex` 값 |
| `swingModeType` | 스윙모드 제어 방식을 지정합니다. `'comfort'`: 무풍 모드, `'wind'`: 상하회전 모드 | X | `"comfort"` |
| `serialNumber`| 홈 앱에 표시할 기기의 시리얼 넘버입니다. | X | `DefaultSN` |
| `cacheDuration` | API 상태를 캐시할 시간(밀리초)입니다. | X | `3000` |


### 모델별 설정 예시

#### 예시 1: 무풍 에어컨 모델
- 스윙 모드를 '무풍'으로 제어합니다.
- 상태 읽기 인덱스는 `1`, 명령 전송 인덱스는 `0`으로 설정된 모델의 경우.
```json
{
  "accessory": "SamsungAC",
  "name": "거실 에어컨 (무풍)",
  "ip": "192.168.1.100",
  "token": "LIVINGROOM_TOKEN",
  "patchCert": "/homebridge/certs/ac-cert.pem",
  "deviceIndex": 1,
  "setDeviceIndex": 0,
  "swingModeType": "comfort" 
}
```

#### 예시 2: 일반 회전 에어컨 모델
- 스윙 모드를 '상하회전'으로 제어합니다.
- 상태 읽기 인덱스는 `0`, 명령 전송 인덱스는 `1`로 설정된 모델의 경우.
```json
{
  "accessory": "SamsungAC",
  "name": "안방 에어컨 (회전)",
  "ip": "192.168.1.101",
  "token": "BEDROOM_TOKEN",
  "patchCert": "/homebridge/certs/ac-cert.pem",
  "deviceIndex": 0,
  "setDeviceIndex": 1, 
  "swingModeType": "wind"
}
```
