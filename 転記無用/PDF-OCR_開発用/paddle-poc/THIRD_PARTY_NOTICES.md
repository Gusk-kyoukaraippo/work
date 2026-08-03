# Third-party notices

- PaddleOCR and `@paddleocr/paddleocr-js` 0.4.2: Apache License 2.0  
  https://github.com/PaddlePaddle/PaddleOCR
- PP-OCRv6 small inference models: distributed by the PaddleOCR project.  
  https://github.com/PaddlePaddle/PaddleOCR
- ONNX Runtime Web 1.22.0: MIT License  
  https://github.com/microsoft/onnxruntime
- OpenCV.js (`@techstark/opencv-js`, bundled in the official Paddle worker): Apache License 2.0
- js-yaml (bundled in the official Paddle worker): MIT License
- clipper-lib (bundled in the official Paddle worker): Boost Software License 1.0

The PoC prepends an offline network guard and supplies embedded asset URLs to the unmodified,
version-pinned PaddleOCR.js worker bundle. The upstream worker bytes and every binary model/runtime
asset are recorded with SHA-256 in `assets.lock.json` after a successful build.
