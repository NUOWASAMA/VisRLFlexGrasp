# 定制 UR5 模型与解析逆运动学

### 模型依据与坐标定义

本实现使用 `embedded/motion/robot_mode/arm_model.ttt` 的原始对象层级，
不是通用 UR5 的标称尺寸。场景 SHA256：
`c2265a92942b4194d81d530127b5d5b662a941f859cabb6cf18fc7f22734708d`。

`embedded/tools/export_ur5_model.py` 只读解析序列化版本 25 的 Huffman 场景，
提取 `_fq`、`Ids`、`Nme`、关节 `_mr` 等记录，不执行场景脚本。
格式依据 [CoppeliaSim 序列化源码](https://github.com/CoppeliaRobotics/coppeliaSimLib/blob/master/sourceCode/serialization/ser.cpp)
及其场景对象、关节对象序列化实现。遇到其他格式、错误记录或不兼容的关节轴线时明确失败。

| 坐标系 | 场景对象或定义 |
| --- | --- |
| 世界 | 场景世界原点 |
| 基座 | `UR5` 对象，世界位置约 `(0.8, 0, 0.014649843)` |
| 六个关节 | `UR5_joint1` 到 `UR5_joint6`，运动为各自局部 `Rz(q)` |
| 法兰 | `UR5_link7`，保留相对关节 6 的约 `0.07667511 m` 固定偏移 |
| TCP | 夹爪零位 `RG2_leftTouch` 和 `RG2_rightTouch` 原点中点，坐标方向与法兰相同 |

IK 接口目标是**基座到法兰**变换。协议抓取位姿是**世界到 TCP**变换：

$$T_{BF} = T_{WB}^{-1} T_{WT} T_{FT}^{-1}.$$

TCP 偏移为本场景夹爪零位标定值，约为法兰局部 Z 方向 `0.199829016 m`；
更换夹爪或改变 TCP 约定时必须重新标定。旧 `ur5_dh_params.md` 的四舍五入表及
“link_6 法兰”称谓不作为本实现的标定依据。

### Craig MDH 与正运动学

全模块加载同一个 `embedded/config/ur5_model.json`。每行参数为 `[a, alpha, d, offset]`：

$$A_i(q_i)=R_x(\alpha_{i-1})T_x(a_{i-1})R_z(q_i+offset_i)T_z(d_i).$$

$$T_{BF}(q)=T_{BM}\left(\prod_{i=1}^{6}A_i(q_i)\right)T_{6F}.$$

参数表约值如下，实际计算保留 JSON 中的完整精度及纳米量级残差：

| 行 | a (m) | alpha (rad) | d (m) | offset (rad) |
| --- | --- | --- | --- | --- |
| 1 | 0 | 0 | 0 | 0 |
| 2 | 0 | -pi/2 | 0.070300039 | -1.570796229 |
| 3 | 0.425099805 | 0 | 0 | -0.000000018224 |
| 4 | 0.392150104 | 0 | 0.039699931 | 1.570796248 |
| 5 | -0.000000032316 | pi/2 | 0.094750106 | 0 |
| 6 | 0 | -pi/2 | -0.014424957 | -pi/2 |

`T_BM` 同时包含基座到 MDH 原点的平移及局部 Z 方向 pi/2 旋转。
原始几何里的肩部偏移、腕部偏移通过固定坐标转换转移到 MDH 的 `d` 与关节零位偏移，
不能只修改通用参数表的大臂、小臂长度。

### 解析逆解推导

使用等价的原始关节坐标链推导，候选解最终由上述 Craig MDH FK 回代校验。
原始关节前固定变换为：

$$B_1=T(p_1),\quad B_2=T(p_2)R_y(-\pi/2),\quad
B_3=T(p_3),\quad B_4=T(p_4),$$
$$B_5=T(p_5)R_y(\pi/2),\quad B_6=T(p_6)R_y(-\pi/2).$$

`p_i` 直接取 JSON 的 `joint_origins` 平移列。当前模型要求 `p6.y=0`，
并保留 `p3.y`、`p4.y`、`p4.z` 等原始小偏移。完整运动链为
`B1 Rz(q1) ... B6 Rz(q6) T6F`。

**肩分支。** 先去掉法兰固定变换得到目标 `T6`；令其平移减去 `p1` 为 `P`，
局部 Z 列为 `n6`，定义：

$$C=P+p_{6x}n_6,\quad A=p_{2x}-p_{3z}-p_{4z}-p_{5z},\quad r=\sqrt{C_x^2+C_y^2}.$$

投影到肩部径向方向消去平面连杆和腕部轴向项，得到：

$$q_1=atan2(C_y,C_x)\pm acos(A/r).$$

`r<|A|` 为不可达。当前模型 `A` 约为 `-0.11 m`。

**腕分支。** 令 `s=q2+q3+q4`，目标旋转化为 ZXZ 分解：

$$R'=R_y(\pi/2)R_z(-q_1)R_6=R_z(s)R_x(q_5)R_z(q_6).$$

使用 `atan2(hypot(R'02,R'12),R'22)` 获得腕角绝对值，枚举正负腕角。
非奇异时：

$$s=atan2(R'_{02}/sin(q_5),-R'_{12}/sin(q_5)),$$
$$q_6=atan2(R'_{20}/sin(q_5),R'_{21}/sin(q_5)).$$

**肘分支。** 去掉已知腕部项：

$$D=R_y(\pi/2)(R_z(-q_1)P-p_2),$$
$$V=D-R_z(s)p_5-R_z(s)R_y(\pi/2)R_z(q_5)p_6.$$

此时 `V=Rz(q2)p3+Rz(q2+q3)p4`。令 `L1=|p3.xy|`、`L2=|p4.xy|`，
`beta1=atan2(p3.y,p3.x)`、`beta2=atan2(p4.y,p4.x)`：

$$e=\pm acos\left(\frac{|V_{xy}|^2-L_1^2-L_2^2}{2L_1L_2}\right),$$
$$q_2=atan2(V_y,V_x)-atan2(L_2sin(e),L_1+L_2cos(e))-beta_1,$$
$$q_3=e-beta_2+beta_1,\quad q_4=s-q_2-q_3.$$

非奇异位形最多八个候选分支，并不保证每个分支均可达或满足限位。

### 奇异位形、限位与回代

腕部 `sin(q5)` 近零时，姿态只约束 `s+q6` 或 `s-q6`。
以参考角的 `s` 为优先代表，另根据平面二连杆的可达环带解析求可行弧段端点和中点。
返回可行连续解族的有限代表，不把除零结果当成逆解，也不以数值迭代替代解析公式。
此处理针对本场景六关节约 `[-2pi,2pi]` 的限位；对更窄的定制限位，有限代表集
可能遗漏连续族中的可行解，需另外做带限位的弧段裁剪。

每个候选按 `2pi` 等价角提升到实际关节限位内、靠近参考角，再做去重及 FK 回代。
位置误差上限 `1e-7 m`，旋转矩阵 Frobenius 残差上限 `1e-7`。
非法刚体目标/参考角抛出 `invalid_argument`；不可达或全部限位过滤后返回空集合。

### 规划与执行边界

服务根据请求的可选 `current_joint_angles` 选解；没有该字段时使用配置初始角。
规划过程不更新当前角，因为本阶段没有执行反馈。
连续五次轨迹采用 `s(t)=10t^3-15t^4+6t^5`，采样点不逐点归一到 `[-pi,pi]`。
按最大速度 `15/8`、最大加速度 `10/sqrt(3)` 的归一化峰值计算轨迹时长。

当前输出 `phase=planned, is_success=true, executed=false`。`force_limit` 仅作为规划元数据保留。
轨迹不是碰撞检测结果，未接仿真步进、夹爪动作、放置动作或力控驱动。
只有执行驱动的真实反馈才能生成 `phase=placed` 的成功状态。

### 可重复验证

在仓库根目录运行：

```powershell
python embedded/tools/export_ur5_model.py
cmake -S embedded -B embedded/build -G "Visual Studio 17 2022" -A x64
cmake --build embedded/build --config Release --parallel
ctest --test-dir embedded/build -C Release --output-on-failure
python -m unittest discover -s tests/unit -v
python -m unittest discover -s tests/integration -v
```

`tests/fixtures/ur5_scene_poses.json` 的 142 个位姿来自原始场景层级的直接连乘，
不使用 MDH；包括零位、随机角、腕部奇异及邻近奇异姿态。
C++ 另验证 2000 个随机/奇异目标、不可达、关节限位及轨迹边界。
TCP 集成测试直接启动编译后的 C++ 程序，连接 Python 后端，验证分帧、坏包恢复、
心跳无回环、断线重连以及规划不会增加分拣计数。
