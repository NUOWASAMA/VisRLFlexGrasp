// 文件功能：世界/TCP 坐标转换、指令校验、选解规划以及应答去回环验证
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-10-06
#include <iostream>
#include <stdexcept>
#include "comm/motion_config.h"
#include "comm/motion_processor.h"
#include "motion/ur5_forward_kinematics.h"
namespace
{
using namespace vis_rl_grasp::comm;
void require(bool value, const std::string& reason)
{
    if (!value)
    {
        throw std::runtime_error(reason);
    }
}
Json array(const Eigen::VectorXd& value)
{
    Json result = Json::array();
    for (Eigen::Index idx = 0; idx < value.size(); ++idx)
    {
        result.push_back(value(idx));
    }
    return result;
}
Json incoming(const std::string& type, const Json& data)
{
    auto result = build_message(type, data);
    result["source"] = "backend";
    result["target"] = "motion";
    return result;
}
void verify(const MotionConfig& config, const motion::RobotModel& model)
{
    MotionProcessor processor(config, model);
    const motion::UR5ForwardKinematics fk(model);
    Eigen::VectorXd joints(6);
    joints << 0.3, -0.4, 0.7, 0.2, -0.5, 0.6;
    const Eigen::Matrix4d desired = fk.compute_fk(joints);
    const Eigen::Matrix4d world_tcp = model.world_from_base * desired * model.flange_from_tcp;
    const Eigen::Quaterniond orientation(world_tcp.block<3, 3>(0, 0));
    Eigen::VectorXd quat(4);
    quat << orientation.x(), orientation.y(), orientation.z(), orientation.w();
    Json data = Json::object();
    data["task_id"] = "math_command";
    data["force_limit"] = 5.0;
    data["grasp_pose"] = Json::object();
    data["grasp_pose"]["position"] = array(world_tcp.block<3, 1>(0, 3));
    data["grasp_pose"]["orientation"] = array(quat);
    const auto command = incoming("grasp_command", data);
    require(processor.handle_line(command.to_string())->at("code").as<int>() == 1003, "未注册指令未拒绝");
    require(!processor.handle_line(incoming("register_ack", Json::object()).to_string()), "注册确认被回发");
    require(processor.is_registered(), "注册状态未更新");
    require(!processor.handle_line(incoming("heartbeat_ack", Json::object()).to_string()), "心跳应答被回发");
    for (int repetition = 0; repetition < 2; ++repetition)
    {
        const auto reply = processor.handle_line(command.to_string());
        require(reply && reply->at("code").as<int>() == 0, "合法规划失败");
        const auto& result = reply->at("data");
        require(result.at("phase").as<std::string>() == "planned"
            && !result.at("executed").as<bool>(), "规划虚报执行完成");
        require(result.at("task_id").as<std::string>() == "math_command", "任务关联丢失");
        require(reply->at("timestamp").as<int64_t>() > 0, "时间戳未填写");
        require(result.at("joint_trajectory").size() == static_cast<size_t>(config.sample_count), "轨迹长度不符");
        Eigen::VectorXd selected(6);
        for (int idx = 0; idx < 6; ++idx)
        {
            selected(idx) = result.at("joint_target")[idx].as<double>();
            require(std::abs(result.at("joint_trajectory")[0][idx].as<double>() - config.initial_joints(idx))
                < 1e-12, "规划更改了未经执行的当前角");
        }
        require((fk.compute_fk(selected) - desired).norm() < 2e-7, "世界/TCP 到基座/法兰转换错误");
    }
    auto with_reference = command;
    with_reference["data"]["current_joint_angles"] = array(joints);
    const auto referenced = processor.handle_line(with_reference.to_string());
    require(referenced->at("code").as<int>() == 0, "传入参考角规划失败");
    require(referenced->at("data").at("reference_source").as<std::string>() == "request", "参考角来源不符");
    require(processor.handle_line("{")->at("code").as<int>() == 1001, "坏 JSON 未拒绝");
    auto broken = command;
    broken.erase("timestamp");
    require(processor.handle_line(broken.to_string())->at("code").as<int>() == 1001, "缺字段报文未拒绝");
    broken = command;
    broken["code"] = "0";
    require(processor.handle_line(broken.to_string())->at("code").as<int>() == 1001, "报文类型未验证");
    broken = command;
    broken["data"]["grasp_pose"]["orientation"] = array(Eigen::VectorXd::Zero(4));
    require(processor.handle_line(broken.to_string())->at("code").as<int>() == 1000, "零四元数未拒绝");
    broken = command;
    broken["data"]["force_limit"] = 0;
    require(processor.handle_line(broken.to_string())->at("code").as<int>() == 1000, "非法夹持力未拒绝");
    broken = command;
    broken["data"].erase("grasp_pose");
    require(processor.handle_line(broken.to_string())->at("code").as<int>() == 1000, "缺目标未拒绝");
    broken = command;
    broken["data"]["grasp_pose"]["position"][0] = 100.0;
    require(processor.handle_line(broken.to_string())->at("code").as<int>() == 3001, "不可达目标未反馈失败");
}
}
int main(int argc, char** argv)
{
    try
    {
        require(argc == 2, "需要配置路径");
        const auto config = MotionConfig::load(argv[1]);
        verify(config, motion::RobotModel::load(config.model_path));
        std::cout << "motion processor: all passed\n";
        return 0;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
