"""Loader contracts with stdlib mocks; never import torch/open_clip in CI."""

from contextlib import nullcontext
from dataclasses import asdict, dataclass
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


@dataclass
class FakePreprocessCfg:
    size: object = 224
    mean: tuple = (0.1, 0.2, 0.3)
    std: tuple = (0.4, 0.5, 0.6)
    interpolation: str = "bicubic"
    resize_mode: str = "shortest"


class ClipEncoderContract(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            "clip_encoder_contract_target",
            Path(__file__).resolve().parents[1] / "scripts/clip_encoder.py",
        )
        self.loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.loader)
        self.visual = MagicMock(image_size=(224, 224))
        self.weight = object()
        self.torch = types.ModuleType("torch")
        self.torch.device = MagicMock(return_value=nullcontext())
        self.torch.load = MagicMock(return_value={
            "visual.conv1.weight": self.weight,
            "token_embedding.weight": object(), "logit_scale": object(),
        })
        self.build = MagicMock(return_value=self.visual)
        self.transform = MagicMock(return_value=object())
        self.config = {"embed_dim": 512, "vision_cfg": {"layers": 12}}
        self.tag = {"mean": (0.7, 0.8, 0.9), "quick_gelu": True,
                    "hf_hub": "must-not-download"}
        modules = {"torch": self.torch, "open_clip": types.ModuleType("open_clip")}
        for name, attrs in {
            "factory": {"get_model_config": MagicMock(return_value=self.config)},
            "model": {"_build_vision_tower": self.build},
            "pretrained": {"get_pretrained_cfg": MagicMock(return_value=self.tag)},
            "transform": {"PreprocessCfg": FakePreprocessCfg,
                          "image_transform_v2": self.transform,
                          "merge_preprocess_dict": lambda base, overlay: {
                              **asdict(base), **{k: v for k, v in overlay.items()
                                                if k in asdict(base)}}},
        }.items():
            module = types.ModuleType("open_clip." + name)
            module.__dict__.update(attrs)
            modules[module.__name__] = module
        self.enterContext(patch.dict(sys.modules, modules))
        self.exists = self.enterContext(patch.object(Path, "is_file", return_value=True))

    def test_only_visual_weights_assigned_without_copy_or_text_tower(self):
        visual, pre = self.loader.load_clip_visual()
        self.assertIs(visual, self.visual)
        self.assertIs(pre, self.transform.return_value)
        self.torch.load.assert_called_once_with(
            self.loader.CHECKPOINT, map_location="cpu", mmap=True, weights_only=True)
        self.torch.device.assert_called_once_with("meta")
        self.build.assert_called_once_with(
            512, self.config["vision_cfg"], quick_gelu=False, cast_dtype=None)
        visual.load_state_dict.assert_called_once_with(
            {"conv1.weight": self.weight}, strict=True, assign=True)
        visual.eval.assert_called_once_with()

    def test_preprocess_uses_tag_defaults_and_actual_visual_size(self):
        self.loader.load_clip_visual()
        cfg = self.transform.call_args.args[0]
        self.assertEqual(cfg.mean, self.tag["mean"])
        self.assertEqual(cfg.std, FakePreprocessCfg().std)
        self.assertEqual(cfg.size, (224, 224))
        self.assertEqual(cfg.interpolation, "bicubic")
        self.assertEqual(cfg.resize_mode, "shortest")
        self.assertEqual(self.transform.call_args.kwargs, {"is_train": False})

    def test_apple_ddp_prefix_and_wrapped_checkpoint(self):
        self.torch.load.return_value = {"state_dict": {
            "module.visual.conv1.weight": self.weight,
            "module.token_embedding.weight": object(),
        }}
        self.loader.load_clip_visual()
        self.visual.load_state_dict.assert_called_once_with(
            {"conv1.weight": self.weight}, strict=True, assign=True)

    def test_missing_checkpoint_fails_before_loading(self):
        self.exists.return_value = False
        with self.assertRaises(FileNotFoundError):
            self.loader.load_clip_visual()
        self.build.assert_not_called()
        self.torch.load.assert_not_called()

    def test_incompatible_weights_fail_strictly_without_fallback(self):
        self.visual.load_state_dict.side_effect = RuntimeError("missing weights")
        with self.assertRaisesRegex(RuntimeError, "missing weights"):
            self.loader.load_clip_visual()
        self.torch.load.assert_called_once()
        self.visual.eval.assert_not_called()

    def test_missing_configuration_fails_before_checkpoint_load(self):
        sys.modules["open_clip.factory"].get_model_config.return_value = None
        with self.assertRaisesRegex(RuntimeError, "configuration"):
            self.loader.load_clip_visual()
        self.torch.load.assert_not_called()


if __name__ == "__main__":
    unittest.main()
