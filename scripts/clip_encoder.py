"""Offline CPU image tower compatible with the existing DFN2B feature cache.

Uses PyTorch's mmap/meta/assign loading recipe (PyTorch >= 2.1). The full
checkpoint is memory-mapped, but only visual.* tensors are assigned or read;
no CLIP text module or second copy of the image weights is constructed.
Call the returned visual directly under torch.inference_mode(). The caller
still owns EXIF/RGB conversion and normalized original-plus-mirror averaging.
"""

from pathlib import Path


CHECKPOINT = (
    Path.home()
    / ".cache/huggingface/hub/models--apple--DFN2B-CLIP-ViT-B-16/snapshots"
    / "8b023e8bb8b0a27c17859af548c9fc3105d6c29c/open_clip_pytorch_model.bin"
)


def load_clip_visual():
    """Return (eval-mode fp32 visual, validation preprocess), without network.

    Deliberately retain quick_gelu=False, matching the original call to
    create_model_and_transforms('ViT-B-16', pretrained='dfn2b'), despite
    DFN2B's QuickGELU warning. Changing it would invalidate cached features.
    Missing/incompatible checkpoints fail rather than downloading or falling
    back to a memory-hungry full-model loader.
    """
    if not CHECKPOINT.is_file():
        raise FileNotFoundError(f"Local DFN2B checkpoint required: {CHECKPOINT}")

    # Keep module import lightweight, including for stdlib-only contract tests.
    import torch
    from open_clip.factory import get_model_config
    from open_clip.model import _build_vision_tower
    from open_clip.pretrained import get_pretrained_cfg
    from open_clip.transform import (
        PreprocessCfg, image_transform_v2, merge_preprocess_dict,
    )

    config = get_model_config("ViT-B-16")
    pretrained = get_pretrained_cfg("ViT-B-16", "dfn2b")
    if not config or not pretrained:
        raise RuntimeError("Installed open_clip lacks ViT-B-16/dfn2b configuration")

    with torch.device("meta"):
        visual = _build_vision_tower(
            config["embed_dim"], config["vision_cfg"],
            quick_gelu=False, cast_dtype=None,
        )

    state = torch.load(CHECKPOINT, map_location="cpu", mmap=True, weights_only=True)
    if "state_dict" in state:
        state = state["state_dict"]
    # Apple's cached checkpoint uses DistributedDataParallel's module. prefix.
    visual_state = {
        key.removeprefix("visual."): value
        for raw_key, value in state.items()
        if (key := raw_key.removeprefix("module.")).startswith("visual.")
    }
    del state  # Drop all text tensor references without touching their storage.
    visual.load_state_dict(visual_state, strict=True, assign=True)
    del visual_state
    visual.eval()

    # Same defaults + pretrained-tag merge + actual image size as the factory.
    preprocess_cfg = merge_preprocess_dict(PreprocessCfg(), pretrained)
    preprocess_cfg["size"] = visual.image_size
    visual.preprocess_cfg = preprocess_cfg
    visual.image_mean = preprocess_cfg["mean"]
    visual.image_std = preprocess_cfg["std"]
    pre = image_transform_v2(PreprocessCfg(**preprocess_cfg), is_train=False)
    return visual, pre
