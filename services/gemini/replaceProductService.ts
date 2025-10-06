/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { 
    processApiError,
    parseDataUrl, 
    callGeminiWithRetry, 
    processGeminiResponse,
    padImageToAspectRatio,
    getAspectRatioPromptInstruction
} from './baseService';

interface ReplaceProductOptions {
    layout: string;
    sceneStyle: string;
    shootingStyle?: string;
    productDescription?: string;
    sceneDescription?: string;
    sceneAction: string;
    productScale: string;
    productShadow?: string;
    decoNotes?: string;
    aspectRatio?: string;
    lightingCategory?: string;
    naturalLight?: string;
    studioLight?: string;
    styleLight?: string;
    synchronizeLighting?: boolean;
}

/**
 * Places a product from one image into a scene from another, with intelligent processing.
 * @param productImageUrl Data URL for the product image.
 * @param sceneImageUrl Data URL for the scene image.
 * @param options User-selected options for layout and style.
 * @param decoImageUrls Array of optional data URLs for decoration images.
 * @returns A promise that resolves to the generated image's data URL.
 */
export async function generateReplacedProductImage(
    productImageUrl: string, 
    sceneImageUrl: string, 
    options: ReplaceProductOptions,
    decoImageUrls: (string | null | undefined)[],
    referenceImageUrl?: string | null
): Promise<string> {
    const sceneImageToProcess = await padImageToAspectRatio(sceneImageUrl, options.aspectRatio ?? 'Giữ nguyên');
    
    const { mimeType: productMime, data: productData } = parseDataUrl(productImageUrl);
    const { mimeType: sceneMime, data: sceneData } = parseDataUrl(sceneImageToProcess);

    const productImagePart = { inlineData: { mimeType: productMime, data: productData } };
    const sceneImagePart = { inlineData: { mimeType: sceneMime, data: sceneData } };

    const parts: any[] = [productImagePart, sceneImagePart];
    let imageCounter = 2; // product=1, scene=2
    
    let decoImageCounter = 0;
    if (decoImageUrls && decoImageUrls.length > 0) {
        decoImageUrls.forEach(url => {
            if (url) {
                const { mimeType, data } = parseDataUrl(url);
                parts.push({ inlineData: { mimeType, data } });
                decoImageCounter++;
            }
        });
    }
    imageCounter += decoImageCounter;

    if (referenceImageUrl) {
        const { mimeType: refMime, data: refData } = parseDataUrl(referenceImageUrl);
        const refImagePart = { inlineData: { mimeType: refMime, data: refData } };
        parts.push(refImagePart);
        imageCounter++;
    }
    
    const promptParts: string[] = [];
    
    promptParts.push('Bạn là một nghệ sĩ ghép ảnh và chuyên gia ánh sáng kỹ thuật số. Nhiệm vụ của bạn là thực hiện một quy trình phức tạp để tạo ra một bức ảnh sản phẩm siêu thực và chuyên nghiệp.');

    if (referenceImageUrl) {
        promptParts.push(
            `\n**PHÂN TÍCH ẢNH THAM CHIẾU (Ảnh ${imageCounter}):**`,
            'Phân tích kỹ lưỡng ảnh này để xác định phong cách nghệ thuật, đặc biệt là về ánh sáng, tông màu, và không khí chung. Nhiệm vụ của bạn là áp dụng CHÍNH XÁC phong cách này vào ảnh kết quả cuối cùng để đảm bảo tính nhất quán.'
        );
    }

    if (options.aspectRatio && options.aspectRatio !== 'Giữ nguyên' && options.aspectRatio !== 'Keep Original') {
        promptParts.push(...getAspectRatioPromptInstruction(options.aspectRatio, 1));
    }

    promptParts.push('\n**QUY TRÌNH BẮT BUỘC:**');
    
    const sceneActionInstruction = options.sceneAction === 'Giữ nguyên bối cảnh' || options.sceneAction === 'Keep Scene As-Is'
        ? 'GIỮ NGUYÊN bối cảnh gốc. TUYỆT ĐỐI KHÔNG xóa bất kỳ vật thể nào.'
        : 'Kiểm tra kỹ ảnh bối cảnh (Ảnh 2). Nếu ảnh này chứa một chủ thể nổi bật (ví dụ: một người mẫu, một sản phẩm thời trang khác), hãy **XÓA** chủ thể đó đi một cách hoàn hảo. Sau khi xóa, hãy sử dụng kỹ thuật inpainting để tái tạo lại phần nền bị che một cách thông minh và liền mạch, đảm bảo không để lại dấu vết. Nếu bối cảnh vốn đã không có chủ thể nổi bật, hãy bỏ qua bước này.';
    
    let productAnalysisPrompt = '1. **PHÂN TÍCH ẢNH SẢN PHẨM (Ảnh 1):** Tự động nhận diện chủ thể sản phẩm chính. Tách nền sản phẩm một cách hoàn hảo, giữ lại mọi chi tiết.';
    if(options.productDescription) {
        productAnalysisPrompt += `\n   - **Mô tả bổ sung về sản phẩm:** ${options.productDescription}. Hãy đảm bảo các chi tiết này được thể hiện rõ trên sản phẩm cuối cùng.`
    }

    let sceneAnalysisPrompt = `2. **PHÂN TÍCH & XỬ LÝ BỐI CẢNH (Ảnh 2):** ${sceneActionInstruction}`;
    if(options.sceneDescription) {
        sceneAnalysisPrompt += `\n   - **Mô tả bổ sung về bối cảnh:** ${options.sceneDescription}. Hãy sử dụng mô tả này để tinh chỉnh hoặc tạo ra bối cảnh cuối cùng.`
    }
    
    promptParts.push(productAnalysisPrompt, sceneAnalysisPrompt);

    // --- STEP 3: COMPOSITION AND LIGHTING ---
    promptParts.push('3. **GHÉP & HÒA TRỘN:** Đặt sản phẩm đã tách nền từ Bước 1 vào bối cảnh đã xử lý từ Bước 2 và thực hiện các bước hòa trộn sau:');

    if (options.synchronizeLighting) {
        promptParts.push(
           '   **3A. TÁI CHIẾU SÁNG (RE-LIGHTING) - YÊU CẦU ƯU TIÊN CAO NHẤT:**',
           '   - **Phân tích ánh sáng bối cảnh:** Phân tích sâu hướng, màu sắc, cường độ, và chất lượng bóng đổ (mềm/gắt) từ Ảnh 2.',
           '   - **Loại bỏ ánh sáng gốc:** HOÀN TOÀN LOẠI BỎ mọi thông tin ánh sáng và bóng đổ gốc của sản phẩm.',
           '   - **Tái tạo ánh sáng mới:** Dựa trên phân tích bối cảnh, "vẽ" lại hoàn toàn các vùng sáng (highlights) và vùng tối (shadows) trên bề mặt sản phẩm để nó khớp 100% với môi trường.',
           '   - **Hòa trộn màu sắc:** Áp dụng một lớp màu (color cast) lên sản phẩm để nhiệt độ màu của nó hòa hợp với không khí chung (ví dụ: ám vàng cam trong cảnh hoàng hôn).',
           '   - **Thêm phản xạ môi trường:** Thêm các phản xạ màu sắc tinh tế từ môi trường xung quanh (ví dụ: ánh xanh của cây cỏ) lên bề mặt sản phẩm.'
        );
    } else {
        promptParts.push(
            '   **3A. HÒA HỢP ÁNH SÁNG CƠ BẢN:** Điều chỉnh độ sáng, độ tương phản và màu sắc của sản phẩm để phù hợp với không khí chung của bối cảnh.'
        );
    }

    promptParts.push(
        '   **3B. TƯƠNG TÁC VẬT LÝ VỚI HIỆU ỨNG ÁNH SÁNG (YÊU CẦU GHI ĐÈ - OVERRIDE):**',
        '   - Đây là yêu cầu vật lý, phải được tuân thủ tuyệt đối.',
        '   - Nếu bối cảnh có các hiệu ứng như **tia nắng (sunbeam/light ray)**, lóa ống kính (lens flare), chúng phải tương tác chính xác với sản phẩm.',
        '   - Tia nắng phải chiếu **LÊN BỀ MẶT** sản phẩm hoặc bị sản phẩm **CHE KHUẤT**.',
        '   - **TUYỆT ĐỐI KHÔNG** được render tia nắng hoặc các hiệu ứng ánh sáng khác nằm ở một lớp (layer) riêng biệt bên dưới hoặc xuyên qua sản phẩm. Sản phẩm là vật thể rắn.'
    );
    
    promptParts.push('   **3C. TẠO BÓNG ĐỔ (SHADOW GENERATION):**');
    if (options.productShadow === 'Không đổ bóng' || options.productShadow === 'No Shadow') {
        promptParts.push('   - **YÊU CẦU GHI ĐÈ (OVERRIDE): TUYỆT ĐỐI KHÔNG TẠO BẤT KỲ BÓNG ĐỔ NÀO CHO SẢN PHẨM.**');
    } else if (options.synchronizeLighting && (options.productShadow === 'Hòa trộn' || options.productShadow === 'Blend' || !options.productShadow || options.productShadow === '')) {
        promptParts.push('   - Tạo ra một bóng đổ mới cho sản phẩm có **hướng, độ mềm/gắt, và màu sắc PHÙ HỢP TUYỆT ĐỐI** với các bóng đổ của những vật thể khác trong bối cảnh. Phân tích kỹ các bóng đổ hiện có trong Ảnh 2 để sao chép chính xác đặc điểm của chúng.');
    } else {
        const shadowInstruction = (options.productShadow && options.productShadow !== 'Tự động' && options.productShadow !== 'Auto' && options.productShadow.trim() !== '') ? options.productShadow : 'Bóng đổ vừa';
        promptParts.push(`   - Tạo ra một ${shadowInstruction.toLowerCase()} cho sản phẩm. Đảm bảo hướng bóng đổ phù hợp với hướng sáng chung của bối cảnh.`);
    }

    if (decoImageCounter > 0) {
        promptParts.push(`4. **DECO SÁNG TẠO (Ảnh 3 đến Ảnh ${3 + decoImageCounter - 1}):** Phân tích (các) ảnh deco này. **YÊU CẦU QUAN TRỌNG:** Chỉ xác định và lấy các **chi tiết trang trí nhỏ lẻ** hoặc các **yếu tố phụ** (ví dụ: hoa, lá, vệt sáng, họa tiết nhỏ) từ (các) ảnh deco này. **TUYỆT ĐỐI KHÔNG** sử dụng toàn bộ ảnh deco làm bối cảnh mới. Sau đó, hãy thêm các chi tiết nhỏ đã trích xuất này vào bối cảnh chính một cách tinh tế để làm cho nó thêm phần sáng tạo và hài hòa. ${options.decoNotes ? `Làm theo chỉ dẫn cụ thể sau từ người dùng: "${options.decoNotes}"` : ''}`);
    }

    promptParts.push('\n**HƯỚNG DẪN CHI TIẾT BỔ SUNG:**');
    
    const layoutMapping: { [key: string]: string } = {
        'Bố Cục Flat Lay (Chụp từ trên xuống)': 'Đặt sản phẩm theo bố cục Flat Lay (chụp thẳng từ trên xuống). Sắp xếp sản phẩm và các phụ kiện liên quan một cách nghệ thuật trên một bề mặt phẳng. Mô phỏng hình dáng sản phẩm như đang được mặc.',
        'Bố Cục Ghost Mannequin (Ma-nơ-canh vô hình)': 'Sử dụng kỹ thuật ma-nơ-canh vô hình (ghost mannequin). Sản phẩm phải trông như đang được mặc bởi một người vô hình, thể hiện rõ phom dáng và độ rủ của vải.',
        'Bố Cục Chụp Treo (Hanging Photography)': 'Treo sản phẩm lên một chiếc móc hoặc giá treo tối giản. Thể hiện sự mềm mại và độ rủ của chất liệu. Có thể thêm hiệu ứng chuyển động nhẹ như vải đang bay.',
        'Bố cục Trung tâm & Đối xứng': 'Đặt sản phẩm ở chính giữa khung hình. Áp dụng bố cục đối xứng để tạo cảm giác cân đối, gọn gàng.',
        'Bố cục Không gian âm': 'Đặt sản phẩm lệch khỏi trung tâm (theo Quy tắc 1/3) trên một nền rộng, trống. Tận dụng không gian âm để làm nổi bật sự tinh tế của sản phẩm.',
        'Bố cục Chi tiết (Close-up)': 'Chụp cận cảnh vào một chi tiết đắt giá của sản phẩm (khóa kéo, đường may, logo, chất liệu). Chi tiết này phải lấp đầy phần lớn khung hình.',
        'Bố cục Sắp xếp nhóm (Group Shot)': 'Sắp xếp một nhóm gồm nhiều sản phẩm (hoặc sản phẩm và phụ kiện) theo Quy tắc số lẻ (3 hoặc 5 món). Sử dụng các đường nét để tạo sự dẫn dắt cho mắt người xem.'
    };
    
    const layoutMappingEn: { [key: string]: string } = {
        'Flat Lay Layout (Top-down Shot)': 'Place the product in a Flat Lay layout (shot directly from above). Artfully arrange the product and related accessories on a flat surface. Simulate the product\'s shape as if it were being worn.',
        'Ghost Mannequin Layout': 'Use the ghost mannequin technique. The product must look as if it is being worn by an invisible person, clearly showing the form and drape of the fabric.',
        'Hanging Layout': 'Hang the product on a minimalist hook or rack. Emphasize the softness and drape of the material. A slight motion effect like flowing fabric can be added.',
        'Center & Symmetric Layout': 'Place the product in the exact center of the frame. Apply a symmetrical composition to create a sense of balance and order.',
        'Negative Space Layout': 'Place the product off-center (following the Rule of Thirds) on a large, empty background. Utilize negative space to highlight the product\'s elegance.',
        'Close-up Detail Layout': 'Take a close-up shot of a valuable detail of the product (zipper, stitching, logo, material). This detail should fill most of the frame.',
        'Group Arrangement Layout': 'Arrange a group of multiple products (or a product with accessories) following the Rule of Odds (3 or 5 items). Use lines and shapes to create a visual path for the viewer\'s eye.'
    };

    const layoutInstruction = layoutMapping[options.layout] || layoutMappingEn[options.layout];

    if (layoutInstruction) {
        promptParts.push(`- **Bố cục:** ${layoutInstruction}`);
    } else if (options.layout && options.layout !== 'Tự động' && options.layout !== 'Auto' && options.layout.trim() !== '') {
        promptParts.push(`- **Bố cục:** Đặt sản phẩm theo kiểu "${options.layout}".`);
    }

    if (options.shootingStyle && options.shootingStyle !== 'Tự động' && options.shootingStyle !== 'Auto' && options.shootingStyle.trim() !== '') {
        promptParts.push(`- **Phong cách chụp:** ${options.shootingStyle}.`);
    }

    if (options.productScale && options.productScale !== 'Tự động' && options.productScale !== 'Auto' && options.productScale.trim() !== '') {
        promptParts.push(`- **Tỷ lệ sản phẩm:** Sản phẩm được ghép vào phải có kích thước tương đối ${options.productScale.toLowerCase()} so với bối cảnh.`);
    }

    let lightingInstruction = '';
    switch (options.lightingCategory) {
        case 'natural': lightingInstruction = options.naturalLight || ''; break;
        case 'studio': lightingInstruction = options.studioLight || ''; break;
        case 'style': lightingInstruction = options.styleLight || ''; break;
    }

    if (lightingInstruction && lightingInstruction !== 'Tự động' && lightingInstruction !== 'Auto' && lightingInstruction.trim() !== '') {
        promptParts.push(`- **Ánh sáng:** ${lightingInstruction}. Ánh sáng này phải được áp dụng cho toàn bộ cảnh một cách chân thực, bao gồm cả việc tạo bóng đổ và phản chiếu chính xác cho sản phẩm.`);
    }

    const styleMapping: { [key: string]: string } = {
        'Giống 100%': '- **Cảm hứng bối cảnh:** GIỮ NGUYÊN 100% ảnh bối cảnh gốc. Chỉ điều chỉnh ánh sáng và bóng đổ trên sản phẩm để khớp với bối cảnh.',
        'Hòa trộn': '- **Cảm hứng bối cảnh:** GIỮ NGUYÊN bối cảnh gốc nhưng cho phép điều chỉnh nhẹ nhàng ánh sáng và màu sắc của cả cảnh để sản phẩm và nền hòa hợp hơn.',
        'Sáng tạo': '- **Cảm hứng bối cảnh:** Sử dụng ảnh bối cảnh gốc làm CẢM HỨNG để tạo ra một bối cảnh MỚI hoàn toàn, nhưng phải giữ được chủ đề và không khí chung (ví dụ: nếu bối cảnh là bãi biển, có thể tạo ra một bãi biển khác vào thời điểm khác trong ngày).'
    };

    const styleMappingEn: { [key: string]: string } = {
        'Match 100%': '- **Scene Inspiration:** PRESERVE 100% of the original scene image. Only adjust lighting and shadows on the product to match the scene.',
        'Blend': '- **Scene Inspiration:** PRESERVE the original scene but allow for gentle adjustments to the lighting and color of the entire scene to better harmonize the product and background.',
        'Creative': '- **Scene Inspiration:** Use the original scene image as INSPIRATION to create a completely NEW scene, but it must maintain the general theme and atmosphere (e.g., if the scene is a beach, a different beach at a different time of day could be created).'
    };

    promptParts.push(styleMapping[options.sceneStyle] || styleMappingEn[options.sceneStyle] || styleMapping['Hòa trộn']);
    
    promptParts.push('\nKết quả cuối cùng phải là một bức ảnh duy nhất, chất lượng cao và siêu thực. Chỉ trả về ảnh kết quả.');

    const prompt = promptParts.join('\n');
    const textPart = { text: prompt };
    parts.push(textPart);

    try {
        console.log("Attempting to generate replaced product image with prompt...", prompt);
        const response = await callGeminiWithRetry(parts);
        return processGeminiResponse(response);
    } catch (error) {
        const processedError = processApiError(error);
        console.error("Error during product replacement generation:", processedError);
        throw processedError;
    }
}
