#!/usr/bin/env python3
import ssl
import socket
import os
import threading

# --- 설정 ---
LISTEN_IP = '0.0.0.0'  # 모든 IP에서 들어오는 연결을 수신
LISTEN_PORT = 8889       # 에어컨이 접속할 포트 (기존 8888과 겹치지 않게)
CERT_FILE = 'cert.pem'   # 플러그인에서 복사해 온 인증서 파일
KEY_FILE = CERT_FILE     # 키 파일도 동일한 파일을 사용

def handle_client(conn, addr):
    """클라이언트 연결 처리 및 데이터 출력"""
    print(f"\n>>> [연결 수립] From: {addr}")
    try:
        # TLS 핸드셰이크가 완료된 보안 소켓
        secure_conn = ssl_context.wrap_socket(conn, server_side=True)

        while True:
            data = secure_conn.recv(8192)
            if not data:
                break

            decoded_data = data.decode('utf-8', errors='ignore')
            print("\n" + "="*20 + " 데이터 수신 " + "="*20)
            print(decoded_data)

            # 'Authorization' 헤더에서 토큰 찾기
            for line in decoded_data.splitlines():
                if 'authorization' in line.lower():
                    print("\n" + "*"*20 + " 🎉 토큰 발견! 🎉 " + "*"*20)
                    # "Authorization: Bearer <TOKEN>" 형식에서 토큰 부분만 추출
                    token = line.split(' ')[-1]
                    print(f"추출된 토큰: {token}")
                    print("*"*56)
                    print("이 토큰을 복사하여 Homebridge 설정에 사용하세요.")

            # 에어컨에 정상적인 응답을 보내 연결을 깔끔하게 종료
            secure_conn.sendall(b'HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n')

    except ssl.SSLError as e:
        print(f"[SSL 오류] 핸드셰이크 실패 가능성: {e}")
    except Exception as e:
        print(f"[오류] 클라이언트 처리 중 오류: {e}")
    finally:
        print(f"<<< [연결 종료] From: {addr}")
        if 'secure_conn' in locals() and secure_conn:
            secure_conn.close()
        elif conn:
            conn.close()

if not os.path.exists(CERT_FILE):
    print(f"[오류] '{CERT_FILE}' 파일을 찾을 수 없습니다.")
    print("이 스크립트와 동일한 폴더에 플러그인의 인증서 파일을 복사해주세요.")
    exit(1)

# SSL 컨텍스트 설정
ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
ssl_context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
# 구형 TLSv1 지원 설정
ssl_context.minimum_version = ssl.TLSVersion.TLSv1
ssl_context.maximum_version = ssl.TLSVersion.TLSv1

print("\n" + "="*60)
print("토큰 리스너 스크립트")
print(f"인증서: '{CERT_FILE}' 사용")
print(f"수신 대기 IP 및 포트: {LISTEN_IP}:{LISTEN_PORT}")
print("="*60)

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((LISTEN_IP, LISTEN_PORT))
    sock.listen(5)

    try:
        while True:
            conn, addr = sock.accept()
            threading.Thread(target=handle_client, args=(conn, addr)).start()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
