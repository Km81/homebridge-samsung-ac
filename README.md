# Homebridge Samsung AC (구형 모델 / Legacy Model)

구형 삼성 에어컨(TLSv1 통신 방식)을 Apple HomeKit에 연동하기 위한 Homebridge 플러그인입니다.

이 플러그인은 최신 Node.js(v17 이상) 환경에서 발생하는 TLS 호환성 문제를 해결하기 위한 패치를 포함하고 있습니다. 또한, **인증서가 플러그인에 내장**되어 있어 사용자는 더 이상 `.pem` 파일을 직접 구하거나 경로를 설정할 필요 없이, 오직 **IP 주소와 토큰만으로** 플러그인을 설정할 수 있습니다.

## 주요 기능

* **구형 삼성 에어컨 지원**: TLSv1 통신 프로토콜을 사용하는 모델 지원
* **최신 Homebridge 호환**: Node.js v17, v18, v22 등 최신 버전에서 발생하는 모든 TLS/HTTP 오류 해결
* **인증서 내장**: 별도의 `.pem` 파일 설정이 필요 없어 설정이 매우 간편함
* **UI 설정 지원**: Homebridge UI를 통해 모든 설정을 간편하게 구성 가능
* **안정적인 통신**: 상태 캐싱, 자동 재시도, 주기적인 상태 폴링 기능 포함

## 사전 준비

* Homebridge 최신 버전 (UI 환경 권장)
* 에어컨의 고정 IP 주소
* **토큰 추출 도구**: `Server8889.py` 와 `ac14k_m.pem` 파일 (추출 과정에서만 필요)

## 설치

Homebridge UI의 '플러그인' 탭에서 `homebridge-samsung-ac`을 검색하여 설치합니다.

---

## **에어컨 토큰(Token) 추출 방법 (필수 절차)**

이 플러그인을 사용하려면 에어컨의 고유 인증 토큰이 필요합니다. 아래 절차에 따라 토큰을 추출할 수 있습니다.

#### **1단계: 준비물 확인 및 배치**

1.  토큰 추출에 필요한 `Server8889.py` 스크립트와 `ac14k_m.pem` 인증서 파일이 필요합니다.
2.  이 두 파일을 Homebridge의 영속적인 저장 공간에 복사합니다.
    * **시놀로지 Docker 사용자**: NAS의 `/docker/homebridge-oznu` 폴더 안에 두 파일을 복사합니다. (컨테이너 내부에서는 `/homebridge` 경로에 해당합니다.)

#### **2단계: 토큰 리스너(Listener) 실행**

1.  PuTTY와 같은 SSH 클라이언트로 NAS에 접속한 후, `sudo -i` 명령어로 root 권한을 얻습니다.
2.  아래 명령어로 Homebridge 컨테이너 내부에 접속합니다.
    ```bash
    docker exec -it homebridge-oznu /bin/sh
    ```
3.  컨테이너 내부에서, 1단계에서 파일을 복사해 둔 폴더로 이동합니다.
    ```bash
    cd /homebridge
    ```
4.  Python 스크립트를 실행하여 토큰 수신 대기 상태로 만듭니다.
    ```bash
    python Server8889.py
    ```
    * *만약 `python` 명령어가 없다면 `python3 Server8889.py`로 시도해 보세요.*
    * 이제 이 PuTTY 창은 토큰이 나타날 때까지 그대로 둡니다.

#### **3단계: 토큰 요청 트리거(Trigger) 실행**

1.  **새로운 PuTTY 창**을 하나 더 엽니다. (기존 창은 그대로 둔 상태)
2.  새 창에서 다시 NAS에 접속하고, `sudo -i`로 root 권한을 얻은 뒤, 아래 명령어로 컨테이너에 접속합니다.
    ```bash
    docker exec -it homebridge-oznu /bin/sh
    ```
3.  컨테이너 내부에서, 파일이 있는 폴더로 이동합니다.
    ```bash
    cd /homebridge
    ```
4.  아래의 `curl` 명령어를 **사용자의 에어컨 IP 주소로 수정한 후** 실행합니다.
    ```bash
    curl -k -H "Content-Type: application/json" -H "DeviceToken: xxxxxxxxxxx" --cert ac14k_m.pem --insecure -X POST [https://192.168.1.](https://192.168.1.)XXX:8888/devicetoken/request
    ```
    * `192.168.1.XXX` 부분을 실제 에어컨의 IP 주소로 변경하세요.
    * `DeviceToken: xxxxxxxxxxx` 부분의 `xxxx...`는 아무 값이나 상관없는 더미 데이터입니다.

#### **4단계: 토큰 확인**

1.  **에어컨 본체의 전원을 켭니다.**
2.  전원을 켜는 순간, **2단계에서 실행했던 첫 번째 PuTTY 창**에 아래와 같은 형식으로 토큰 정보가 나타납니다.
    ```json
    {"DeviceToken":"XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"} 
    ```
3.  `DeviceToken`의 값(따옴표 안의 내용)을 복사합니다. 이것이 바로 Homebridge 설정에 필요한 토큰입니다.
4.  토큰 추출이 완료되었으면 두 개의 PuTTY 창을 모두 닫아도 됩니다.

---

## 설정

Homebridge UI의 플러그인 설정 화면에서 아래 항목들을 입력합니다.

| 키 | 설명 | 필수 | 기본값 |
| :--- | :--- | :--- | :--- |
| `name` | 홈 앱에 표시될 에어컨의 이름입니다. | 예 | - |
| `ip` | 에어컨의 고정 IP 주소입니다. | 예 | - |
| `token` | 위에서 추출한 인증 토큰입니다. | 예 | - |
| `deviceIndex`| (선택) 상태를 **읽어올** 장치의 인덱스(0부터 시작). 실내기가 여러 대일 경우 구분합니다. | 아니오 | `0` |
| `setDeviceIndex`| (선택) 명령을 **보낼** 장치의 인덱스. 보통 `deviceIndex`와 같습니다. | 아니오 | `deviceIndex` 값 |
| `swingModeType` | (선택) 스윙(회전) 모드를 제어할 방식을 선택합니다. (`comfort` 또는 `wind`) | 아니오 | `comfort` |
| `pollingInterval`| (선택) 상태를 자동으로 동기화할 시간 간격(단위: 초). 0이면 비활성화됩니다. | 아니오 | 비활성화 |

#### `config.json` 직접 수정 예시

인증서가 내장되어 있으므로 설정이 매우 간단합니다.

```json
{
  "bridge": { ... },
  "accessories": [
    {
      "accessory": "SamsungAC",
      "name": "거실 에어컨",
      "ip": "192.168.1.100",
      "token": "YOUR-EXTRACTED-TOKEN-HERE"
    },
    {
      "accessory": "SamsungAC",
      "name": "안방 에어컨",
      "ip": "192.168.1.100",
      "token": "YOUR-EXTRACTED-TOKEN-HERE",
      "deviceIndex": 1,
      "setDeviceIndex": 0
    }
  ]
}
```

### ⚠️ 보안 경고

이 플러그인은 오래된 보안 프로토콜(TLSv1)을 사용하여 에어컨과 통신합니다. 신뢰할 수 있는 **로컬 네트워크 환경에서만 사용**하시는 것을 강력히 권장합니다.
