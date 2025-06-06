# homebridge-samsung-ac

다양한 삼성 에어컨 모델을 지원하기 위해 통합되고 최적화된 스마트 홈브리지 플러그인입니다.

## 주요 특징
- 💨 **통합 모델 지원**: `config.json` 설정만으로 무풍 에어컨과 일반 회전 에어컨 모델을 모두 지원합니다.
- ⚡️ **고성능**: `axios`와 상태 캐싱을 적용하여 매우 빠르고 안정적으로 동작합니다.
- 📦 **의존성 최소화**: `curl`, `jq` 같은 외부 프로그램 설치가 필요 없습니다.
- ⚙️ **유연한 설정**: 기기 인덱스, 스윙 모드 타입 등을 자유롭게 설정할 수 있습니다.

## 설치
1. Homebridge UI에 접속하여 '플러그인' 탭으로 이동합니다.
2. 검색창에 `homebridge-samsung-ac`를 검색하여 설치합니다.

## 설정 (`config.json`)

**주의:** `accessory` 값은 반드시 **"SamsungAC"** 로 설정해야 합니다.

```json
{
  "accessory": "SamsungAC",
  "name": "거실 에어컨",
  "ip": "192.168.x.x",
  "token": "YOUR_TOKEN",
  "patchCert": "/path/to/your/cert.pem",
  "deviceIndex": 0,
  "setDeviceIndex": 0,
  "swingModeType": "comfort"
}
```

### 설정 옵션 상세

| 키 | 설명 | 필수 | 기본값 |
|---|---|:---:|---|
| `accessory` | 플러그인 이름. **"SamsungAC"**로 고정 | O | |
| `name` | HomeKit에 표시될 이름 | O | |
| `ip` | 에어컨의 고정 IP 주소 | O | |
| `token` | API 인증 토큰 | O | |
| `patchCert`| 인증서 파일(`*.pem`)의 절대 경로. Docker 사용 시 컨테이너 내부 경로. | O | |
| `deviceIndex` | API에서 상태를 **읽어올** 기기의 인덱스(0부터 시작) | X | `0` |
| `setDeviceIndex` | API로 명령을 **보낼** 때 사용할 기기의 인덱스 | X | `deviceIndex` 값 |
| `swingModeType` | 스윙모드 제어 방식. `"comfort"`: 무풍 모드, `"wind"`: 상하회전 모드 | X | `"comfort"` |
| `serialNumber`| HomeKit에 표시할 시리얼 넘버 | X | `DefaultSN` |

### 모델별 설정 예시

#### 예시 1: 무풍 에어컨 (첫 번째 코드 기반)
* `deviceIndex`: 1, `setDeviceIndex`: 0, `swingModeType`: comfort
```json
{
  "accessory": "SamsungAC",
  "name": "거실 에어컨 (무풍)",
  "ip": "192.168.x.x",
  "token": "YOUR_TOKEN",
  "patchCert": "/home/pi/ac-cert.pem",
  "deviceIndex": 1,
  "setDeviceIndex": 0,
  "swingModeType": "comfort" 
}
```

#### 예시 2: 일반 에어컨 (두 번째 코드 기반)
* `deviceIndex`: 0, `setDeviceIndex`: 1, `swingModeType`: wind
```json
{
  "accessory": "SamsungAC",
  "name": "안방 에어컨 (회전)",
  "ip": "192.168.x.x",
  "token": "YOUR_TOKEN",
  "patchCert": "/home/pi/ac-cert.pem",
  "deviceIndex": 0,
  "setDeviceIndex": 1, 
  "swingModeType": "wind"
}
```
