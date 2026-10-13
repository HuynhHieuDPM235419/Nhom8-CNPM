<?php

use App\Http\Controllers\MasterThesisController;
use App\Http\Controllers\PostgradAdmissionController;
use App\Http\Controllers\PostgradSubjectController;

// Đăng ký tuyển sinh sau đại học (Thạc sĩ/Tiến sĩ)
Route::post('/postgrad/register', [PostgradAdmissionController::class, 'register']);

// Duyệt nhập học, cấp MSHV Cao học
Route::post('/postgrad/admission', [PostgradAdmissionController::class, 'admission']);

// Đăng ký học phần (các môn chuyên đề sau đại học)
Route::post('/postgrad/subjects', [PostgradSubjectController::class, 'registerSubjects']);

// Đăng ký đề tài luận văn thạc sĩ và báo cáo tiến độ
Route::post('/postgrad/thesis', [MasterThesisController::class, 'registerThesis']);

?>
