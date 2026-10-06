# 文件功能：读取本仓库序列化版本 25 的场景，导出关节原点、等价 Craig MDH 及独立测试位姿
# 作者：VisRLFlexGrasp 项目组
# 创建日期：2026-10-06
"""格式依据 CoppeliaRobotics/coppeliaSimLib 的 ser.cpp、sceneObject.cpp、jointObject.cpp。

仅提取静态层级及关节参数，不运行场景脚本，不改变原始 .ttt 文件。
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import struct


def identity():
    return [[float(row == col) for col in range(4)] for row in range(4)]


def multiply(left, right):
    return [[sum(left[row][idx] * right[idx][col] for idx in range(4))
             for col in range(4)] for row in range(4)]


def inverse(pose):
    result = identity()
    for row in range(3):
        for col in range(3):
            result[row][col] = pose[col][row]
        result[row][3] = -sum(result[row][idx] * pose[idx][3] for idx in range(3))
    return result


def z_frame(angle, distance=0.0):
    cosine, sine = math.cos(angle), math.sin(angle)
    return [[cosine, -sine, 0.0, 0.0], [sine, cosine, 0.0, 0.0],
            [0.0, 0.0, 1.0, distance], [0.0, 0.0, 0.0, 1.0]]


def pose_matrix(values):
    scalar, x, y, z, px, py, pz = values
    return [[1 - 2 * (y*y + z*z), 2 * (x*y - z*scalar), 2 * (x*z + y*scalar), px],
            [2 * (x*y + z*scalar), 1 - 2 * (x*x + z*z), 2 * (y*z - x*scalar), py],
            [2 * (x*z - y*scalar), 2 * (y*z + x*scalar), 1 - 2 * (x*x + y*y), pz],
            [0.0, 0.0, 0.0, 1.0]]


def mdh_matrix(row, angle=0.0):
    length, twist, distance, offset = row
    ca, sa = math.cos(twist), math.sin(twist)
    ct, st = math.cos(angle + offset), math.sin(angle + offset)
    return [[ct, -st, 0.0, length], [ca*st, ca*ct, -sa, -distance*sa],
            [sa*st, sa*ct, ca, distance*ca], [0.0, 0.0, 0.0, 1.0]]


def difference(left, right):
    return max(abs(left[row][col] - right[row][col]) for row in range(4) for col in range(4))


def decode_scene(raw):
    if len(raw) < 1021 or raw[:4] != b'VREP' or struct.unpack_from('<I', raw, 4)[0] != 25:
        raise ValueError('仅支持 VREP 序列化版本 25；其他版本请用 CoppeliaSim 导出 URDF')
    size = struct.unpack_from('<I', raw, 13)[0]
    if not 0 < size <= 100_000_000:
        raise ValueError('场景解压长度非法')
    data = raw[1021:]
    if raw[12] == 0:
        if len(data) != size:
            raise ValueError('未压缩场景长度不符')
        return data
    if raw[12] != 1:
        raise ValueError('未知压缩格式')
    bit = 0
    leaves = set()

    def read_bits(count):
        nonlocal bit
        value = 0
        for _ in range(count):
            if bit >= len(data) * 8:
                raise ValueError('Huffman 数据截断')
            value = (value << 1) | ((data[bit // 8] >> (7 - bit % 8)) & 1)
            bit += 1
        return value

    def read_tree(depth=0):
        if depth > 255:
            raise ValueError('Huffman 树深度非法')
        if read_bits(1):
            symbol = read_bits(8)
            if symbol in leaves:
                raise ValueError('Huffman 叶节点重复')
            leaves.add(symbol)
            return symbol
        return read_tree(depth + 1), read_tree(depth + 1)

    root = read_tree()
    output = bytearray()
    for _ in range(size):
        node = root
        while isinstance(node, tuple):
            node = node[read_bits(1)]
        output.append(node)
    return bytes(output)


def records(data):
    offset = 0
    while offset + 3 <= len(data):
        name = data[offset:offset + 3].decode('ascii')
        offset += 3
        if name == 'EOF':
            return
        if name in ('NXT', 'EOO'):
            continue
        if offset + 4 > len(data):
            raise ValueError('记录头截断')
        size = struct.unpack_from('<i', data, offset)[0]
        offset += 4
        if size < 0 or offset + size > len(data):
            raise ValueError('记录长度非法')
        yield name, data[offset:offset + size]
        offset += size


def read_objects(data):
    objects = {}
    for kind, payload in records(data):
        if payload[:3] != b'3do':
            continue
        obj = {'kind': kind}
        for name, value in records(payload):
            if name == 'Ids':
                obj['id'], obj['parent'] = struct.unpack('<ii', value)
            elif name in ('Ali', 'Nme'):
                obj[name] = value[4:].decode('utf-8')
            elif name == '_fq':
                obj['pose'] = list(struct.unpack('<7d', value))
            elif kind == 'JNT' and name == '_mr' and len(value) == 16:
                obj['minimum'], obj['range'] = struct.unpack('<2d', value)
            elif kind == 'JNT' and name == '_rt':
                obj['angle'] = struct.unpack('<d', value)[0]
        if not all(name in obj for name in ('id', 'parent', 'pose', 'Nme')):
            raise ValueError('场景对象缺少必要字段')
        objects[obj['id']] = obj
    return objects


def relative(objects, child, parent):
    result = identity()
    visited = set()
    while child != parent:
        if child in visited or child not in objects:
            raise ValueError('场景层级有循环或目标不是后代')
        visited.add(child)
        obj = objects[child]
        result = multiply(pose_matrix(obj['pose']), result)
        child = obj['parent']
    return result


def export(scene, model_path, fixture_path):
    raw = scene.read_bytes()
    objects = read_objects(decode_scene(raw))
    names = {obj['Nme']: idx for idx, obj in objects.items()}
    base = names['UR5']
    joints = [names[f'UR5_joint{idx}'] for idx in range(1, 7)]
    flange = names['UR5_link7']
    origins = [relative(objects, child, parent) for child, parent in zip(joints, [base] + joints[:-1])]
    adapters = [z_frame(math.pi/2, origins[1][2][3]),
                z_frame(math.atan2(origins[2][1][3], origins[2][0][3])),
                z_frame(math.atan2(origins[3][1][3], origins[3][0][3])),
                z_frame(math.pi/2, origins[4][2][3]),
                z_frame(math.pi/2, origins[5][2][3]), z_frame(0)]
    mdh = [[0.0, 0.0, 0.0, 0.0]]
    for idx in range(1, 6):
        transform = multiply(multiply(inverse(adapters[idx - 1]), origins[idx]), adapters[idx])
        twist = math.atan2(-transform[1][2], transform[2][2])
        row = [transform[0][3], twist,
               transform[2][3]*math.cos(twist) - transform[1][3]*math.sin(twist),
               math.atan2(-transform[0][1], transform[0][0])]
        if difference(transform, mdh_matrix(row)) > 1e-10:
            raise ValueError('场景运动链不满足本模型的 Craig MDH 转换条件')
        mdh.append(row)
    tool = identity()
    left, right = relative(objects, names['RG2_leftTouch'], flange), relative(objects, names['RG2_rightTouch'], flange)
    for row in range(3):
        tool[row][3] = (left[row][3] + right[row][3]) / 2
    model = {
        'schema_version': 1,
        'provenance': {'scene': 'embedded/motion/robot_mode/arm_model.ttt',
                       'sha256': hashlib.sha256(raw).hexdigest(), 'serialization_version': 25,
                       'joint_objects': [objects[idx]['Nme'] for idx in joints],
                       'base_object': 'UR5', 'flange_object': 'UR5_link7',
                       'tcp_definition': '零位 RG2_leftTouch/RG2_rightTouch 原点中点，方向与法兰相同'},
        'world_from_base': relative(objects, base, -1),
        'base_from_mdh': multiply(origins[0], adapters[0]),
        'mdh': mdh, 'joint_origins': origins,
        'joint6_from_flange': relative(objects, flange, joints[-1]),
        'flange_from_tcp': tool,
        'joint_min': [objects[idx]['minimum'] for idx in joints],
        'joint_max': [objects[idx]['minimum'] + objects[idx]['range'] for idx in joints],
    }
    rng = random.Random(20261006)
    angles = [[0.0]*6, [0.3, -0.4, 0.7, 0.2, -0.5, 0.6]]
    angles += [[rng.uniform(-math.pi, math.pi) for _ in range(6)] for _ in range(100)]
    for wrist in (0.0, math.pi, -math.pi, 1e-8, -1e-8):
        for _ in range(8):
            values = [rng.uniform(-math.pi, math.pi) for _ in range(6)]
            values[4] = wrist
            angles.append(values)
    # 独立基准：按原场景固定层级逐一插入关节 Rz(q)，不使用导出的 MDH 参数。
    cases = []
    for values in angles:
        actual = identity()
        calculated = model['base_from_mdh']
        for origin, row, angle in zip(origins, mdh, values):
            actual = multiply(multiply(actual, origin), z_frame(angle))
            calculated = multiply(calculated, mdh_matrix(row, angle))
        actual = multiply(actual, model['joint6_from_flange'])
        calculated = multiply(calculated, model['joint6_from_flange'])
        if difference(actual, calculated) > 1e-10:
            raise ValueError('MDH 与场景原始层级不一致')
        cases.append({'joint_angles': values, 'base_from_flange': actual})
    fixtures = {'scene_sha256': model['provenance']['sha256'], 'cases': cases}
    for path, value in ((model_path, model), (fixture_path, fixtures)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'导出成功：{len(cases)} 个场景层级校验位姿，SHA256={model["provenance"]["sha256"]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', type=Path, default=Path('embedded/motion/robot_mode/arm_model.ttt'))
    parser.add_argument('--model', type=Path, default=Path('embedded/config/ur5_model.json'))
    parser.add_argument('--fixtures', type=Path, default=Path('tests/fixtures/ur5_scene_poses.json'))
    args = parser.parse_args()
    export(args.scene, args.model, args.fixtures)
