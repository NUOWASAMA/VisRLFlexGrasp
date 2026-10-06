# 文件功能：运动学库、通信服务及 CTest，依赖版本统一管理
cmake_minimum_required(VERSION 3.20)
project(visrl_motion_control LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(cmake/dependencies.cmake)
find_package(Threads REQUIRED)
include(CTest)

add_library(visrl_motion
    motion/robot_model.cpp
    motion/ur5_forward_kinematics.cpp
    motion/ur5_inverse_kinematics.cpp
    motion/trajectory_planner.cpp
    motion/kinematics_utils.cpp)
target_include_directories(visrl_motion PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(visrl_motion PUBLIC Eigen3::Eigen PRIVATE visrl_jsoncons_headers)

add_library(visrl_comm comm/tcp_client.cpp comm/motion_config.cpp comm/motion_processor.cpp)
target_include_directories(visrl_comm PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(visrl_comm PUBLIC Threads::Threads visrl_motion visrl_jsoncons_headers)
if(WIN32)
    target_compile_definitions(visrl_comm PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(visrl_comm PRIVATE ws2_32)
endif()

add_executable(motion_control comm/motion_service_main.cpp)
target_link_libraries(motion_control PRIVATE visrl_motion visrl_comm visrl_jsoncons_headers)

if(MSVC)
    foreach(target visrl_motion visrl_comm motion_control)
        target_compile_options(${target} PRIVATE /utf-8 /W4 /permissive-)
    endforeach()
else()
    foreach(target visrl_motion visrl_comm motion_control)
        target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic)
    endforeach()
endif()

if(BUILD_TESTING)
    add_executable(motion_unit_tests ../tests/unit/test_motion.cpp)
    target_link_libraries(motion_unit_tests PRIVATE visrl_motion visrl_jsoncons_headers)
    if(MSVC)
        target_compile_options(motion_unit_tests PRIVATE /utf-8 /W4)
    endif()
    add_test(NAME motion_math COMMAND motion_unit_tests
        ${CMAKE_CURRENT_SOURCE_DIR}/config/ur5_model.json
        ${CMAKE_CURRENT_SOURCE_DIR}/../tests/fixtures/ur5_scene_poses.json)
    add_executable(motion_processor_tests ../tests/unit/test_motion_processor.cpp)
    target_link_libraries(motion_processor_tests PRIVATE visrl_comm)
    if(MSVC)
        target_compile_options(motion_processor_tests PRIVATE /utf-8 /W4)
    endif()
    add_test(NAME motion_processor COMMAND motion_processor_tests ${CMAKE_CURRENT_SOURCE_DIR}/config/base.json)
    set_tests_properties(motion_processor PROPERTIES ENVIRONMENT "VISRL_ENV=sim")
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    add_test(NAME motion_tcp_integration
        COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/../tests/integration/test_motion_service.py)
    set_tests_properties(motion_tcp_integration PROPERTIES
        ENVIRONMENT "VISRL_MOTION_BINARY=$<TARGET_FILE:motion_control>"
        TIMEOUT 45)
endif()
