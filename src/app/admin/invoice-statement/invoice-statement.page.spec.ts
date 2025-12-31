import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InvoiceStatementPage } from './invoice-statement.page';

describe('InvoiceStatementPage', () => {
  let component: InvoiceStatementPage;
  let fixture: ComponentFixture<InvoiceStatementPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(InvoiceStatementPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
