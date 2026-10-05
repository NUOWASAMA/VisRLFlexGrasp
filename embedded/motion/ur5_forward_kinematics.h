#ifndef UR5_FORWARD_KINEMATICS_H
#define UR5_FORWARD_KINEMATICS_H

#include <Eigen/Dense>

namespace motion
{

  class UR5ForwardKinematics
  {
  public:
    UR5ForwardKinematics();
    Eigen::Matrix4d compute_fk(const Eigen::VectorXd &joint_angle);

  private:
    Eigen::MatrixXd mdh_params_;
    Eigen::Matrix4d get_link_transform(double a, double alpha, double d, double theta);
  };
}

#endif