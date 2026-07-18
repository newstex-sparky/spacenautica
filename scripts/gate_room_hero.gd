# Gate Room Hero — GDScript implementation for beauty shot
# @icon: res://icons/godot_icon.png

class_name GateRoomHero extends Node3D

## Hero scene for cinematic beauty shot. Renders the gate-room from a cinematic angle.

const CAM_POS = Vector3(0.0, 3.0, 8.0)
const CAM_LOOK_Y = Vector2(0.0, 0.0)
const GATE_Z = 0.0

## Default exposure (adjust for tonal balance)
export var tonemap_exposure: float = 0.8

# Portal shader uniforms (accessed via material)
@onready var portal_material = $GateRing?.get_surface_override_material(0)

func _ready() -> void:
	super()

	# Set camera parameters
	if $MainCamera:
		$MainCamera.position = CAM_POS
		if $MainCamera.transform.basis.xform(Vector3.UP).y > 0:
			$MainCamera.look_at(Vector3(CAM_POS.x, CAM_LOOK_Y.y, CAM_POS.z), Vector3.UP)
		else:
			# Fallback if camera is flipped
			$MainCamera.rotation.x = deg_to_rad(-25)  # Tilt camera down slightly

	# Expose shader uniform if available
	if portal_material:
		if portal_material.shader:
			if portal_material.shader.get_default_parameter("u_energy"):
				portal_material.set_shader_parameter("u_energy", tonemap_exposure)

	# Enable HDR rendering
	if RenderingServer.get_rendering_device():
		RenderingServer.tone_mapper_set_exposure(tonemap_exposure)

func _process(_delta: float) -> void:
	pass