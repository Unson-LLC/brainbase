import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    fputs("usage: vision_ocr IMAGE\n", stderr)
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: imageURL),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
    fputs("failed to load image\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["ja-JP", "en-US"]
request.usesLanguageCorrection = true
request.minimumTextHeight = 0.006

do {
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let observations = request.results ?? []
    let lines = observations.compactMap { observation -> (CGRect, String)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (observation.boundingBox, candidate.string)
    }
    // Kindle screenshots are usually two vertical pages. Reading order is
    // right-to-left by column, and top-to-bottom within a column.
    let sorted = lines.sorted { lhs, rhs in
        let columnTolerance: CGFloat = 0.025
        if abs(lhs.0.midX - rhs.0.midX) > columnTolerance {
            return lhs.0.midX > rhs.0.midX
        }
        return lhs.0.maxY > rhs.0.maxY
    }
    for (_, line) in sorted {
        print(line)
    }
} catch {
    fputs("Vision OCR failed: \(error)\n", stderr)
    exit(1)
}
