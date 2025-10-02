/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { 
    processApiError, 
    padImageToAspectRatio,
    parseDataUrl, 
    callGeminiWithRetry, 
    processGeminiResponse 
} from './baseService';

interface TshirtOptions {
    bodyColor: string;
    leftSleeveColor: string;
    rightSleeveColor: string;
    collarColor: string;
    hemColor: string;
    printStyle: string;
    printSize: string;
    printNotes: string;
    fit: string;
    fabric: string;
}

interface PatternDesignerOptions {
    applicationMode: string;
    patternScale: string;
    aspectRatio: string;
    colorChange: {
        notes: string;
        color1: string;
        color2: string;
        color3: string;
        color4: string;
    };
    productType: string;
    notes: string;
    tshirt: TshirtOptions;
}

/**
 * Generates an image of clothing with a new pattern applied.
 * @param clothingImageDataUrl Data URL for the base clothing image.
 * @param pattern1ImageDataUrl Data URL for the primary pattern image.
 * @param options User-selected options for the design.
 * @param pattern2ImageDataUrl Optional data URL for a second pattern to mix.
 * @returns A promise that resolves to the generated image's data URL.
 */
export async function generatePatternedClothingImage(
    clothingImageDataUrl: string, 
    pattern1ImageDataUrl: string, 
    options: PatternDesignerOptions,
    pattern2ImageDataUrl?: string | null
): Promise<string> {
    const clothingImageToProcess = await padImageToAspectRatio(clothingImageDataUrl, options.aspectRatio ?? 'Giữ nguyên');
    const { mimeType: clothingMime, data: clothingData } = parseDataUrl(clothingImageToProcess);
    const { mimeType: pattern1Mime, data: pattern1Data } = parseDataUrl(pattern1ImageDataUrl);

    const clothingImagePart = { inlineData: { mimeType: clothingMime, data: clothingData } };
    const pattern1ImagePart = { inlineData: { mimeType: pattern1Mime, data: pattern1Data } };

    const parts: any[] = [clothingImagePart, pattern1ImagePart];
    let patternImageCount = 1;

    if (pattern2ImageDataUrl) {
        const { mimeType: pattern2Mime, data: pattern2Data } = parseDataUrl(pattern2ImageDataUrl);
        const pattern2ImagePart = { inlineData: { mimeType: pattern2Mime, data: pattern2Data } };
        parts.push(pattern2ImagePart);
        patternImageCount = 2;
    }
    
    const promptParts = [
        'Bạn là một chuyên gia thiết kế thời trang AI. Nhiệm vụ của bạn là áp dụng một họa tiết lên một sản phẩm may mặc.',
        '**QUY TRÌNH 3 BƯỚC:**',
        '1. **PHÂN TÍCH ẢNH TRANG PHỤC (Ảnh 1):** Đây là "nền tảng". Giữ nguyên 100% kích thước, bố cục, người mẫu, tư thế, và bối cảnh của ảnh này. Đây là yêu cầu quan trọng nhất.',
        `2. **TRÍCH XUẤT HỌA TIẾT (Ảnh 2${patternImageCount > 1 ? ' và Ảnh 3' : ''}):** Chỉ lấy MẪU HỌA TIẾT hoặc KẾT CẤU từ (các) ảnh này. Bỏ qua tất cả các yếu tố khác (bố cục, vật thể, chữ viết). ${patternImageCount > 1 ? 'Hãy kết hợp cả hai họa tiết một cách sáng tạo.' : ''}`,
        '3. **ÁP DỤNG HỌA TIẾT:** Áp dụng họa tiết đã trích xuất lên sản phẩm may mặc trong Ảnh 1 một cách tự nhiên. Họa tiết phải tuân theo các nếp gấp, hình dạng và ánh sáng của trang phục gốc.',
        '\n**HƯỚNG DẪN BỔ SUNG:**'
    ];
    
    if (options.applicationMode && options.applicationMode !== 'Tự động') {
        promptParts.push(`- **Chế độ Áp dụng:** ${options.applicationMode}.`);
    }
    if (options.patternScale && options.patternScale !== 'Tự động') {
        promptParts.push(`- **Tỷ lệ Họa tiết (Toàn cục):** Áp dụng họa tiết với kích thước ${options.patternScale.toLowerCase()}.`);
    }
    if (options.colorChange && options.colorChange.notes) {
        const colorRefs = [
            options.colorChange.color1 && `Màu 1 (${options.colorChange.color1})`,
            options.colorChange.color2 && `Màu 2 (${options.colorChange.color2})`,
            options.colorChange.color3 && `Màu 3 (${options.colorChange.color3})`,
            options.colorChange.color4 && `Màu 4 (${options.colorChange.color4})`,
        ].filter(Boolean).join(', ');

        promptParts.push(`- **Thay đổi màu:** ${options.colorChange.notes}. ${colorRefs ? `Các màu tham chiếu: ${colorRefs}.` : ''}`);
    }
    if (options.productType && options.productType !== 'Tự động') {
        promptParts.push(`- **Loại sản phẩm:** ${options.productType}.`);
    }
    if (options.notes) {
        promptParts.push(`- **Ghi chú thêm:** ${options.notes}`);
    }

    if (options.productType === 'Áo Thun (T-shirt/Polo)') {
        const tshirtDetails = [];
        const { tshirt } = options;
        if (tshirt.bodyColor) tshirtDetails.push(`  - Màu thân áo: ${tshirt.bodyColor}.`);
        if (tshirt.leftSleeveColor) tshirtDetails.push(`  - Màu tay áo TRÁI: ${tshirt.leftSleeveColor}.`);
        if (tshirt.rightSleeveColor) tshirtDetails.push(`  - Màu tay áo PHẢI: ${tshirt.rightSleeveColor}.`);
        if (tshirt.collarColor) tshirtDetails.push(`  - Màu cổ áo: ${tshirt.collarColor}.`);
        if (tshirt.hemColor) tshirtDetails.push(`  - Màu lai áo: ${tshirt.hemColor}.`);
        if (tshirt.printStyle && tshirt.printStyle !== 'Tự động') tshirtDetails.push(`  - Kiểu in: ${tshirt.printStyle}.`);
        if (tshirt.printSize && tshirt.printSize !== 'Tự động') tshirtDetails.push(`  - Kích thước họa tiết in: ${tshirt.printSize}.`);
        if (tshirt.printNotes) tshirtDetails.push(`  - Ghi chú họa tiết in: ${tshirt.printNotes}.`);
        if (tshirt.fit && tshirt.fit !== 'Tự động') tshirtDetails.push(`  - Form áo: ${tshirt.fit}.`);
        if (tshirt.fabric && tshirt.fabric !== 'Tự động') tshirtDetails.push(`  - Chất liệu vải: Mô phỏng kết cấu của vải ${tshirt.fabric}.`);

        if (tshirtDetails.length > 0) {
            promptParts.push('\n**YÊU CẦU CHI TIẾT VỀ ÁO THUN (ƯU TIÊN TUYỆT ĐỐI):**', ...tshirtDetails);
        }
    }
    
    promptParts.push(
        '\nKết quả cuối cùng phải là một bức ảnh duy nhất, chất lượng cao. Chỉ trả về ảnh kết quả.'
    );

    const prompt = promptParts.join('\n');
    const textPart = { text: prompt };
    parts.push(textPart);

    try {
        console.log("Attempting to generate patterned clothing image with dynamic prompt...", prompt);
        const response = await callGeminiWithRetry(parts);
        return processGeminiResponse(response);
    } catch (error) {
        const processedError = processApiError(error);
        console.error("Error during pattern design generation:", processedError);
        throw processedError;
    }
}
