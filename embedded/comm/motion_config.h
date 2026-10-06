// 文件功能：运动服务配置，模型路径相对于配置目录解析
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#pragma once
#include <string>
#include <Eigen/Dense>
namespace vis_rl_grasp::comm
{
struct MotionConfig
{
    std::string server_host;
    int server_port;
    std::string model_path;
    Eigen::VectorXd initial_joints;
    Eigen::VectorXd max_velocity;
    Eigen::VectorXd max_acceleration;
    double minimum_duration;
    double maximum_force;
    int sample_count;
    // base.json 按 VISRL_ENV=dev/sim/real 深合并同目录覆盖文件；其他文件独立加载。
    // 未接驱动阶段只接受 plan_only、enable_hardware=false；非法配置抛出异常。
    static MotionConfig load(const std::string& path);
};
}
