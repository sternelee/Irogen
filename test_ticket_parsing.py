#!/usr/bin/env python3

import base64
import json

# 从上面的输出中提取的会话票据
ticket = "PMRHI33QNFRV62LEEI5FWNJMGEZTOLBSGQYSYOJVFQYTONBMGE3DCLBSGUZCYOJRFQZDINBMGIYCYMZWFQYTEMBMGM3CYOJWFQZDINRMGEYDSLBRGA4SYMJVGUWDOMZMGU3SYNBMG44SYNJRFQYTELBRGM3SYOJTFQZTCLBYFQ4TALBSGEZSYNRYFQZDIOK5FQRG433EMVZSEOS3PMRG433EMVPWSZBCHIRDMMJZMQZDONZVGBRDCNJRGI2TGNTGME4TAYZYGY3DMOBWMFSDOZTEG5SDIMJQGU2TGYLCMVRWIY3DMNRGCZBTG44GCNBWGFTDQOBYGARCYITSMVWGC6K7OVZGYIR2NZ2WY3BMEJSGS4TFMN2F6YLEMRZGK43TMVZSEOS3EIYTENZOGAXDALRRHIYCEXL5LV6Q===="

try:
    # Base32 解码
    import base64
    decoded = base64.b32decode(ticket)
    print(f"Decoded bytes length: {len(decoded)}")
    
    # 尝试解析为 JSON
    try:
        data = json.loads(decoded.decode('utf-8'))
        print("Successfully parsed JSON:")
        print(json.dumps(data, indent=2))
        
        # 检查是否包含必要的字段
        if 'topic_id' in data:
            print(f"✅ Topic ID found: {data['topic_id']}")
        else:
            print("❌ Topic ID not found")
            
        if 'nodes' in data and len(data['nodes']) > 0:
            print(f"✅ Nodes found: {len(data['nodes'])} node(s)")
            for i, node in enumerate(data['nodes']):
                print(f"  Node {i}: {node}")
        else:
            print("❌ No nodes found")
            
    except json.JSONDecodeError as e:
        print(f"❌ Failed to parse JSON: {e}")
        print(f"Raw decoded data: {decoded}")
        
except Exception as e:
    print(f"❌ Failed to decode ticket: {e}")