<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\PostgradStudent;
use PDF;

// Sử dụng thư viện DomPDF hoặc Snappy

class PostgradAdmissionController extends Controller
{
    // API: /postgrad/register (Nộp hồ sơ dự thi/xét tuyển sau đại học)
    public function register(Request $request)
    {
        $validated = $request->validate([
            'full_name' => 'required|string|max:255',
            'email' => 'required|email|unique:postgrad_students',
            'program_level' => 'required|in:Master,PhD', // Thạc sĩ hoặc Tiến sĩ
            'major_code' => 'required|string' // Mã ngành (VD: Khoa học máy tính, QTKD)
        ]);

        $student = PostgradStudent::create(array_merge($validated, ['admission_status' => 'pending']));

        return response()->json(['message' => 'Lưu hồ sơ dự tuyển thành công', 'data' => $student], 201);
    }

    // API: /postgrad/admission (Nhập học, cấp MSHV và xuất giấy báo)
    public function admission(Request $request)
    {
        $student = PostgradStudent::findOrFail($request->id);

        // Logic cấp MSHV Cao học (VD: CH + Năm + Mã Ngành + STT)
        // Ví dụ: CH26IT001 (Cao học năm 2026, ngành IT, số 001)
        $year = date('y');
        $mshv = 'CH' . $year . $student->major_code . str_pad($student->id, 3, '0', STR_PAD_LEFT);

        $student->update([
            'mshv' => $mshv,
            'admission_status' => 'admitted'
        ]);

        // Xuất PDF Giấy báo trúng tuyển Bậc Sau Đại học
        $pdfContent = '
            <div style="text-align: center;">
                <h2>TRƯỜNG ĐẠI HỌC AN GIANG</h2>
                <h3>PHÒNG ĐÀO TẠO SAU ĐẠI HỌC</h3>
                <hr style="width: 50%;">
                <h2 style="color: #d32f2f;">GIẤY BÁO TRÚNG TUYỂN VÀ GỌI NHẬP HỌC</h2>
                <h4>BẬC ĐÀO TẠO: ' . ($student->program_level == 'Master' ? 'THẠC SĨ' : 'TIẾN SĨ') . '</h4>
            </div>
            <p>Hội đồng tuyển sinh Sau đại học thông báo anh/chị:</p>
            <p>Họ và tên: <b>' . $student->full_name . '</b></p>
            <p>Mã số học viên: <b>' . $mshv . '</b></p>
            <p>Ngành trúng tuyển: <b>' . $student->major_code . '</b></p>
            <p>Đề nghị anh/chị mang theo đầy đủ hồ sơ gốc và học phí kỳ 1 để hoàn tất thủ tục nhập học.</p>
        ';

        $pdf = PDF::loadHTML($pdfContent);
        $fileName = 'Giay_Bao_Nhap_Hoc_SDH_' . $mshv . '.pdf';
        $pdf->save(storage_path('app/public/admissions/' . $fileName));

        return response()->json([
            'message' => 'Nhập học thành công, đã cấp MSHV',
            'mshv' => $mshv,
            'pdf_url' => asset('storage/admissions/' . $fileName)
        ]);
    }
}    
?>
