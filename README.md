# Homebridge Samsung AC (구형 모델 / Legacy Model)

구형 삼성 에어컨(TLSv1 통신 방식)을 Apple HomeKit에 연동하기 위한 Homebridge 플러그인입니다.

이 플러그인은 최신 Node.js(v17 이상) 환경에서 발생하는 TLS 호환성 문제를 해결하기 위한 패치를 포함하고 있습니다. 또한, **인증서가 플러그인에 내장**되어 있어 사용자는 더 이상 `.pem` 파일을 직접 구하거나 경로를 설정할 필요 없이, 오직 **IP 주소와 토큰만으로** 플러그인을 설정할 수 있습니다.

## 주요 기능

* **구형 삼성 에어컨 지원**: TLSv1 통신 프로토콜을 사용하는 모델 지원
* **최신 Homebridge 호환**: Node.js v17, v18, v22 등 최신 버전에서 발생하는 모든 TLS/HTTP 오류 해결
* **파일 없는(File-less) 설정**: 인증서 내장 및 토큰 추출 스크립트 제공으로 별도 파일 다운로드 불필요
* **UI 설정 지원**: Homebridge UI를 통해 모든 설정을 간편하게 구성 가능
* **안정적인 통신**: 상태 캐싱, 자동 재시도, 주기적인 상태 폴링 기능 포함

## 사전 준비

* Homebridge 최신 버전 (UI 환경 권장)
* 에어컨의 고정 IP 주소
* Python 3 (토큰 추출 과정에서만 필요)

## 설치

Homebridge UI의 '플러그인' 탭에서 `homebridge-samsung-ac`을 검색하여 설치합니다.

---

## **에어컨 토큰(Token) 추출 방법 (필수 절차)**

이 플러그인을 사용하려면 에어컨의 고유 인증 토큰이 필요합니다. 아래 절차는 어떤 파일도 다운로드할 필요 없이 진행할 수 있습니다.

#### **1단계: 토큰 리스너(Listener) 스크립트 준비 및 실행**

1.  아래의 Python 코드를 복사하여 컴퓨터에 `token_listener.py` 라는 이름으로 저장합니다.

    ```python
    #!/usr/bin/env python3
    import ssl
    import socket
    import os

    # 설정
    SERVER_IP = '0.0.0.0'
    SERVER_PORT = 8889
    CERT_FILE = 'temp_server_cert.pem'
    KEY_FILE = 'temp_server_key.pem'

    def generate_self_signed_cert(cert_file, key_file):
        """임시 SSL 서버 인증서 생성"""
        if not (os.path.exists(cert_file) and os.path.exists(key_file)):
            print(f"임시 서버 인증서 '{cert_file}' 및 '{key_file}' 생성 중...")
            os.system(f'openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 -keyout {key_file} -out {cert_file} -subj "/CN=homebridge-ac-server"')

    def main():
        """가짜 서버를 실행하여 토큰을 수신하고 출력"""
        generate_self_signed_cert(CERT_FILE, KEY_FILE)
        context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        
        print("\n" + "="*50)
        print(f"토큰 수신 대기 중... (포트: {SERVER_PORT})")
        print("이 창을 그대로 두고, 새 터미널 창에서 다음 단계를 진행하세요.")
        print("에어컨 전원을 켜면 여기에 토큰이 출력됩니다.")
        print("="*50)

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((SERVER_IP, SERVER_PORT))
            sock.listen(1)
            with context.wrap_socket(sock, server_side=True) as ssock:
                try:
                    conn, addr = ssock.accept()
                    with conn:
                        print(f"\n[리스너] 에어컨으로부터 연결 수립: {addr}")
                        data = conn.recv(4096)
                        if data:
                            print("\n" + "="*20 + " 토큰 수신 완료! " + "="*20)
                            print(data.decode('utf-8', errors='ignore'))
                            print("="*54)
                            print("위 내용에서 'DeviceToken' 값을 복사하여 사용하세요.")
                except ssl.SSLError as e:
                    print(f"\n[리스너] SSL 오류 발생: {e}")
                    print("에어컨이 이 서버의 임시 인증서를 신뢰하지 않았을 수 있습니다.")
                except Exception as e:
                    print(f"\n[리스너] 오류 발생: {e}")
                finally:
                    print("[리스너] 스크립트를 종료합니다. 임시 인증서는 삭제하셔도 됩니다.")
                    if os.path.exists(CERT_FILE): os.remove(CERT_FILE)
                    if os.path.exists(KEY_FILE): os.remove(KEY_FILE)

    if __name__ == '__main__':
        main()
    ```

2.  PuTTY 등으로 NAS에 접속하여 Homebridge의 영속적인 폴더(예: `/docker/homebridge-oznu`)에 위에서 만든 `token_listener.py` 파일을 업로드합니다.
3.  터미널에서 `docker exec -it homebridge-oznu /bin/sh` 명령어로 컨테이너에 접속한 뒤, `cd /homebridge`로 이동합니다.
4.  아래 명령어로 토큰 리스너를 실행합니다.
    ```sh
    python3 token_listener.py
    ```
5.  이제 이 터미널 창은 그대로 둡니다.

#### **2단계: 토큰 요청 스크립트 실행**

1.  아래의 Python 코드를 복사하여 컴퓨터에 `token_trigger.py` 라는 이름으로 저장합니다. **이 코드 안에는 `ac14k_m.pem`의 내용이 이미 포함되어 있습니다.**

    ```python
    #!/usr/bin/env python3
    import ssl
    import socket
    import tempfile
    import os

    # --- 설정 ---
    AC_IP = "192.168.1.XXX"  # <<-- 여기에 실제 에어컨 IP 주소를 입력하세요!
    AC_PORT = 8888
    
    # ac14k_m.pem 인증서 내용을 여기에 내장합니다.
    PEM_CONTENT = """
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
    """

    def main():
        """에어컨에 토큰 생성을 요청하는 스크립트"""
        if "192.168.1.XXX" in AC_IP:
            print("오류: 스크립트의 AC_IP 변수를 실제 에어컨의 IP 주소로 수정해주세요.")
            return

        # 내장된 인증서 내용을 임시 파일로 저장
        with tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.pem') as temp_pem_file:
            temp_pem_file.write(PEM_CONTENT)
            temp_pem_path = temp_pem_file.name
        
        print(f"에어컨({AC_IP})에 토큰 요청을 보냅니다...")

        try:
            context = ssl.create_default_context()
            context.load_cert_chain(certfile=temp_pem_path)
            
            headers = {
                "Content-Type": "application/json",
                "DeviceToken": "xxxxxxxxxxx", # 더미 토큰
                "Connection": "close"
            }
            
            # 저수준 소켓을 사용하여 직접 요청
            with socket.create_connection((AC_IP, AC_PORT), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=AC_IP) as ssock:
                    request_line = f"POST /devicetoken/request HTTP/1.1\r\n"
                    header_lines = "\r\n".join(f"{k}: {v}" for k, v in headers.items())
                    request = f"{request_line}{header_lines}\r\n\r\n"
                    
                    ssock.sendall(request.encode('utf-8'))
                    response = ssock.recv(4096).decode('utf-8', errors='ignore')
                    print(f"\n[트리거] 에어컨으로부터 응답 수신:\n{response}")
                    print("\n[트리거] 요청을 성공적으로 보냈습니다. 이제 리스너 창을 확인하세요.")

        except Exception as e:
            print(f"\n[트리거] 요청 중 오류 발생: {e}")
        finally:
            # 임시 파일 삭제
            if os.path.exists(temp_pem_path):
                os.remove(temp_pem_path)

    if __name__ == '__main__':
        main()
    ```

2.  **새로운 PuTTY 창**을 하나 더 엽니다.
3.  새 창에서 컨테이너에 접속(`docker exec ...`)하고 `/homebridge` 폴더로 이동합니다.
4.  위에서 만든 `token_trigger.py` 파일을 업로드하고, **파일 상단의 `AC_IP` 변수 값을 실제 에어컨 IP로 수정한 뒤** 아래 명령어로 실행합니다.
    ```sh
    python3 token_trigger.py
    ```

#### **4단계: 토큰 확인 및 정리**

1.  **에어컨 본체의 전원을 켭니다.**
2.  전원을 켜면 **1단계의 `token_listener.py`가 실행 중인 첫 번째 터미널 창**에 토큰 정보가 나타납니다.
3.  토큰을 복사한 후, 두 스크립트와 터미널 창은 모두 종료합니다. 임시로 생성된 파일들은 스크립트가 자동으로 정리합니다.

---
## 설정

Homebridge UI의 플러그인 설정 화면에서 아래 항목들을 입력합니다. 인증서 경로 설정은 더 이상 필요 없습니다.

| 키 | 설명 | 필수 |
| :--- | :--- | :--- |
| `name` | 홈 앱에 표시될 에어컨의 이름. | 예 |
| `ip` | 에어컨의 고정 IP 주소. | 예 |
| `token` | 위에서 추출한 인증 토큰. | 예 |
| `deviceIndex`| (선택) 상태를 **읽어올** 장치의 인덱스(0부터). | 아니오 |
| `setDeviceIndex`| (선택) 명령을 **보낼** 장치의 인덱스. | 아니오 |
| `swingModeType` | (선택) 스윙 모드 제어 방식 (`comfort` 또는 `wind`). | 아니오 |
| `pollingInterval`| (선택) 상태 자동 동기화 간격(초). 0이면 비활성화. | 아니오 |

#### `config.json` 직접 수정 예시
```json
{
  "bridge": { ... },
  "accessories": [
    {
      "accessory": "SamsungAC",
      "name": "거실 에어컨",
      "ip": "192.168.1.100",
      "token": "YOUR-EXTRACTED-TOKEN-HERE"
    }
  ]
}
```

### ⚠️ 보안 경고

이 플러그인은 오래된 보안 프로토콜(TLSv1)을 사용하여 에어컨과 통신합니다. 신뢰할 수 있는 **로컬 네트워크 환경에서만 사용**하시는 것을 강력히 권장합니다.
